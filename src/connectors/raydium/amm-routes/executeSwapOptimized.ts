import { VersionedTransaction } from '@solana/web3.js';
import BN from 'bn.js';
import { FastifyPluginAsync, FastifyInstance } from 'fastify';

import { Solana, BASE_FEE } from '../../../chains/solana/solana';
import {
  ExecuteSwapResponse,
  ExecuteSwapResponseType,
  ExecuteSwapRequest,
  ExecuteSwapRequestType,
} from '../../../schemas/swap-schema';
import { logger } from '../../../services/logger';
import { Raydium } from '../raydium';

import { getRawSwapQuote } from './quoteSwap';

// Pre-assembly manager for ultra-fast swaps
class PreAssemblyManager {
  private raydium: Raydium;
  private solana: Solana;
  private refreshTimer?: NodeJS.Timeout;
  private readonly REFRESH_INTERVAL = 5000; // 5 seconds

  constructor(raydium: Raydium, solana: Solana) {
    this.raydium = raydium;
    this.solana = solana;
  }

  async preAssembleSwap(
    poolAddress: string,
    baseToken: string,
    quoteToken: string,
    amount: number,
    side: 'BUY' | 'SELL',
    slippagePct: number,
  ): Promise<VersionedTransaction | null> {
    try {
      // Check if we have a cached transaction
      const cachedTransaction = this.raydium.getCachedSwap(
        poolAddress,
        baseToken,
        quoteToken,
        amount,
        side,
        slippagePct,
      );

      if (cachedTransaction) {
        logger.info('Using cached pre-assembled transaction');
        return cachedTransaction;
      }

      // Get pool info (cached)
      const poolInfo = await this.raydium.getAmmPoolInfo(poolAddress);
      if (!poolInfo) {
        throw new Error(`Pool not found: ${poolAddress}`);
      }

      // Get quote (cached)
      const quote = await getRawSwapQuote(
        this.raydium,
        'mainnet-beta',
        poolAddress,
        baseToken,
        quoteToken,
        amount,
        side,
        slippagePct,
      );

      const inputToken = quote.inputToken;
      const outputToken = quote.outputToken;

      const COMPUTE_UNITS = 600000;
      const currentPriorityFee =
        (await this.solana.estimateGas()) * 1e9 - BASE_FEE;
      const priorityFeePerCU = Math.floor(
        (currentPriorityFee * 1e6) / COMPUTE_UNITS,
      );

      let transaction: VersionedTransaction;

      // Build transaction based on pool type
      if (poolInfo.poolType === 'amm') {
        // Always use exact input for consistent behavior - both BUY and SELL specify input amount
        ({ transaction } = (await this.raydium.raydiumSDK.liquidity.swap({
          poolInfo: quote.poolInfo,
          poolKeys: quote.poolKeys,
          amountIn: new BN(quote.amountIn),
          amountOut: quote.minAmountOut,
          fixedSide: 'in',
          inputMint: inputToken.address,
          txVersion: this.raydium.txVersion,
          computeBudgetConfig: {
            units: COMPUTE_UNITS,
            microLamports: priorityFeePerCU,
          },
        })) as { transaction: VersionedTransaction });
      } else if (poolInfo.poolType === 'cpmm') {
        // Always use exact input for consistent behavior - both BUY and SELL specify input amount
        ({ transaction } = (await this.raydium.raydiumSDK.cpmm.swap({
          poolInfo: quote.poolInfo,
          poolKeys: quote.poolKeys,
          inputAmount: quote.amountIn,
          swapResult: {
            sourceAmountSwapped: quote.amountIn,
            destinationAmountSwapped: quote.amountOut,
          },
          slippage: slippagePct / 100,
          baseIn: inputToken.address === quote.poolInfo.mintA.address,
          txVersion: this.raydium.txVersion,
          computeBudgetConfig: {
            units: COMPUTE_UNITS,
            microLamports: priorityFeePerCU,
          },
        })) as { transaction: VersionedTransaction });
      } else {
        throw new Error(`Unsupported pool type: ${poolInfo.poolType}`);
      }

      // Cache the transaction
      this.raydium.setCachedSwap(
        poolAddress,
        baseToken,
        quoteToken,
        amount,
        side,
        slippagePct,
        transaction,
      );

      return transaction;
    } catch (error) {
      logger.error('Error pre-assembling swap:', error);
      return null;
    }
  }

  startBackgroundRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    this.refreshTimer = setInterval(() => {
      logger.debug('Background cache refresh running...');
      // The cache cleanup is handled automatically by the Raydium class
    }, this.REFRESH_INTERVAL);
  }

  stopBackgroundRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }
}

async function executeSwapOptimized(
  fastify: FastifyInstance,
  network: string,
  walletAddress: string,
  baseToken: string,
  quoteToken: string,
  amount: number,
  side: 'BUY' | 'SELL',
  poolAddress: string,
  slippagePct?: number,
): Promise<ExecuteSwapResponseType> {
  const solana = await Solana.getInstance(network);
  const raydium = await Raydium.getInstance(network);
  const wallet = await solana.getWallet(walletAddress);

  // Get pool info from address (cached)
  const poolInfo = await raydium.getAmmPoolInfo(poolAddress);
  if (!poolInfo) {
    throw fastify.httpErrors.notFound(`Pool not found: ${poolAddress}`);
  }

  // Use configured slippage if not provided
  const effectiveSlippage = slippagePct || raydium.getSlippagePct();

  logger.info(
    `Executing optimized ${amount.toFixed(4)} ${side} swap in pool ${poolAddress}`,
  );

  // Pre-assemble the transaction
  const preAssemblyManager = new PreAssemblyManager(raydium, solana);
  const transaction = await preAssemblyManager.preAssembleSwap(
    poolAddress,
    baseToken,
    quoteToken,
    amount,
    side,
    effectiveSlippage,
  );

  if (!transaction) {
    throw new Error('Failed to pre-assemble swap transaction');
  }

  // Sign and execute the transaction
  transaction.sign([wallet]);
  await solana.simulateTransaction(transaction as VersionedTransaction);

  const { confirmed, signature, txData } =
    await solana.sendAndConfirmRawTransaction(transaction);

  if (confirmed && txData) {
    const { baseTokenBalanceChange, quoteTokenBalanceChange } =
      await solana.extractPairBalanceChangesAndFee(
        signature,
        await solana.getToken(poolInfo.baseTokenAddress),
        await solana.getToken(poolInfo.quoteTokenAddress),
        wallet.publicKey.toBase58(),
      );

    logger.info(
      `Optimized swap executed successfully: ${Math.abs(side === 'SELL' ? baseTokenBalanceChange : quoteTokenBalanceChange).toFixed(4)} ${baseToken} -> ${Math.abs(side === 'SELL' ? quoteTokenBalanceChange : baseTokenBalanceChange).toFixed(4)} ${quoteToken}`,
    );

    return {
      signature,
      totalInputSwapped: Math.abs(
        side === 'SELL' ? baseTokenBalanceChange : quoteTokenBalanceChange,
      ),
      totalOutputSwapped: Math.abs(
        side === 'SELL' ? quoteTokenBalanceChange : baseTokenBalanceChange,
      ),
      fee: txData.meta.fee / 1e9,
      baseTokenBalanceChange,
      quoteTokenBalanceChange,
    };
  }

  throw new Error('Swap execution failed');
}

export const executeSwapOptimizedRoute: FastifyPluginAsync = async (
  fastify,
) => {
  // Get first wallet address for example
  const solana = await Solana.getInstance('mainnet-beta');
  let firstWalletAddress = '<solana-wallet-address>';

  try {
    firstWalletAddress =
      (await solana.getFirstWalletAddress()) || firstWalletAddress;
  } catch (error) {
    logger.warn('No wallets found for examples in schema');
  }

  fastify.post<{
    Body: ExecuteSwapRequestType;
    Reply: ExecuteSwapResponseType;
  }>(
    '/execute-swap-optimized',
    {
      schema: {
        description:
          'Execute an optimized swap on Raydium AMM or CPMM with caching and pre-assembly',
        tags: ['raydium/amm'],
        body: {
          ...ExecuteSwapRequest,
          properties: {
            ...ExecuteSwapRequest.properties,
            network: { type: 'string', default: 'mainnet-beta' },
            walletAddress: { type: 'string', examples: [firstWalletAddress] },
            baseToken: { type: 'string', examples: ['SOL'] },
            quoteToken: { type: 'string', examples: ['USDC'] },
            amount: { type: 'number', examples: [0.01] },
            side: { type: 'string', examples: ['SELL'] },
            poolAddress: { type: 'string', examples: [''] },
            slippagePct: { type: 'number', examples: [1] },
          },
        },
        response: { 200: ExecuteSwapResponse },
      },
    },
    async (request) => {
      try {
        const {
          network,
          walletAddress,
          baseToken,
          quoteToken,
          amount,
          side,
          poolAddress,
          slippagePct,
        } = request.body;
        const networkToUse = network || 'mainnet-beta';

        // If no pool address provided, find default pool
        let poolAddressToUse = poolAddress;
        if (!poolAddressToUse) {
          const raydium = await Raydium.getInstance(networkToUse);
          poolAddressToUse = await raydium.findDefaultPool(
            baseToken,
            quoteToken,
            'amm',
          );
          if (!poolAddressToUse) {
            throw fastify.httpErrors.notFound(
              `No AMM pool found for pair ${baseToken}-${quoteToken}`,
            );
          }
        }

        return await executeSwapOptimized(
          fastify,
          networkToUse,
          walletAddress,
          baseToken,
          quoteToken,
          amount,
          side as 'BUY' | 'SELL',
          poolAddressToUse,
          slippagePct,
        );
      } catch (e) {
        logger.error(e);
        throw fastify.httpErrors.internalServerError(
          'Failed to execute optimized swap',
        );
      }
    },
  );
};
