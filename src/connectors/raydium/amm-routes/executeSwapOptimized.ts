import { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { VersionedTransaction } from '@solana/web3.js';
import { BN } from 'bn.js';

import { logger, addPSTTimestamp } from '../../../services/logger';
import { Solana } from '../../../chains/solana/solana';
import { Raydium } from '../../../connectors/raydium/raydium';
import { getRawSwapQuote } from './quoteSwap';
import {
  ExecuteSwapRequestType,
  ExecuteSwapResponseType,
  ExecuteSwapRequest,
  ExecuteSwapResponse,
} from '../../../schemas/swap-schema';

// Pre-computed priority fees for common SELL pairs (in SOL)
const SELL_PRIORITY_FEES: Record<string, number> = {
  'SOL/USDC': 0.0001,
  'SOL/RAY': 0.0001,
  'RAY/SOL': 0.0001,
  'USDC/SOL': 0.0001,
  default: 0.0001,
};

const BASE_FEE = 5000; // Base fee in lamports

/**
 * Pre-assembly manager for optimized swap transactions
 */
class PreAssemblyManager {
  private raydium: Raydium;
  private solana: Solana;
  private refreshTimer?: NodeJS.Timeout;
  private readonly REFRESH_INTERVAL = 5000; // 5 seconds

  constructor(raydium: Raydium, solana: Solana) {
    this.raydium = raydium;
    this.solana = solana;
  }

  /**
   * Get optimized priority fee for SELL orders
   */
  private getOptimizedPriorityFee(
    baseToken: string,
    quoteToken: string,
    side: 'BUY' | 'SELL',
  ): number {
    if (side !== 'SELL') {
      return 0; // Use default calculation for BUY orders
    }

    const pairKey = `${baseToken}/${quoteToken}`;
    const reversePairKey = `${quoteToken}/${baseToken}`;

    // Try exact match first
    if (SELL_PRIORITY_FEES[pairKey]) {
      return SELL_PRIORITY_FEES[pairKey];
    }

    // Try reverse pair
    if (SELL_PRIORITY_FEES[reversePairKey]) {
      return SELL_PRIORITY_FEES[reversePairKey];
    }

    // Fall back to default
    return SELL_PRIORITY_FEES.default;
  }

  async preAssembleSwap(
    poolAddress: string,
    baseToken: string,
    quoteToken: string,
    amount: number,
    side: 'BUY' | 'SELL',
    slippagePct: number,
    swapDirection?: 'exactAmountIn' | 'exactAmountOut',
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
      
      // Use optimized priority fees for SELL orders
      const optimizedPriorityFee = this.getOptimizedPriorityFee(
        baseToken,
        quoteToken,
        side,
      );
      const currentPriorityFee =
        optimizedPriorityFee > 0
          ? optimizedPriorityFee * 1e9 // Convert from SOL to lamports
          : (await this.solana.estimateGas()) * 1e9 - BASE_FEE;

      const priorityFeePerCU = Math.floor(
        (currentPriorityFee * 1e6) / COMPUTE_UNITS,
      );

      logger.info(
        `Using ${side === 'SELL' ? 'optimized' : 'standard'} priority fee: ${(
          currentPriorityFee / 1e9
        ).toFixed(6)} SOL`,
      );

      let transaction: VersionedTransaction;

      // Get transaction based on pool type
      if (poolInfo.poolType === 'amm') {
        // AMM swap
        const [poolInfoData, poolKeysData] =
          await this.raydium.getPoolfromAPI(poolAddress);

        // Determine fixedSide based on swapDirection parameter or default behavior
        const effectiveSwapDirection =
          swapDirection ||
          (side === 'BUY' ? 'exactAmountOut' : 'exactAmountIn');
        const fixedSide = effectiveSwapDirection === 'exactAmountIn' ? 'in' : 'out';

        logger.info(
          `Using ${effectiveSwapDirection} for ${side} order (fixedSide: ${fixedSide})`,
        );

        if (fixedSide === 'out') {
          // AMM swap base out (exact output)
          ({ transaction } = (await this.raydium.raydiumSDK.liquidity.swap({
            poolInfo: poolInfoData,
            poolKeys: poolKeysData,
            amountIn: quote.maxAmountIn,
            amountOut: new BN(quote.amountOut),
            fixedSide: 'out',
            inputMint: inputToken.address,
            txVersion: this.raydium.txVersion,
            computeBudgetConfig: {
              units: COMPUTE_UNITS,
              microLamports: priorityFeePerCU,
            },
          })) as { transaction: VersionedTransaction });
        } else {
          // AMM swap (exact input)
          ({ transaction } = (await this.raydium.raydiumSDK.liquidity.swap({
            poolInfo: poolInfoData,
            poolKeys: poolKeysData,
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
        }
      } else if (poolInfo.poolType === 'cpmm') {
        // CPMM swap
        const [poolInfoData, poolKeysData] =
          await this.raydium.getPoolfromAPI(poolAddress);
        const rpcData = await this.raydium.raydiumSDK.cpmm.getRpcPoolInfo(
          poolAddress,
          true,
        );
        const baseIn = inputToken.address === poolInfoData.mintA.address;

        // Determine fixedSide based on swapDirection parameter or default behavior
        const effectiveSwapDirection =
          swapDirection ||
          (side === 'BUY' ? 'exactAmountOut' : 'exactAmountIn');
        const fixedSide = effectiveSwapDirection === 'exactAmountIn' ? 'in' : 'out';

        logger.info(
          `CPMM: Using ${effectiveSwapDirection} for ${side} order (fixedSide: ${fixedSide})`,
        );

        if (fixedSide === 'out') {
          // CPMM swap base out (exact output)
          ({ transaction } = (await this.raydium.raydiumSDK.cpmm.swap({
            poolInfo: poolInfoData,
            poolKeys: poolKeysData,
            inputAmount: quote.maxAmountIn,
            swapResult: {
              sourceAmountSwapped: quote.maxAmountIn,
              destinationAmountSwapped: new BN(quote.amountOut),
            },
            slippage: slippagePct / 100,
            baseIn,
            txVersion: this.raydium.txVersion,
            computeBudgetConfig: {
              units: COMPUTE_UNITS,
              microLamports: priorityFeePerCU,
            },
          })) as { transaction: VersionedTransaction });
        } else {
          // CPMM swap (exact input)
          ({ transaction } = (await this.raydium.raydiumSDK.cpmm.swap({
            poolInfo: poolInfoData,
            poolKeys: poolKeysData,
            inputAmount: new BN(quote.amountIn),
            swapResult: {
              sourceAmountSwapped: new BN(quote.amountIn),
              destinationAmountSwapped: quote.minAmountOut,
            },
            slippage: slippagePct / 100,
            baseIn,
            txVersion: this.raydium.txVersion,
            computeBudgetConfig: {
              units: COMPUTE_UNITS,
              microLamports: priorityFeePerCU,
            },
          })) as { transaction: VersionedTransaction });
        }
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
      logger.error(`Error pre-assembling swap: ${error.message}`);
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
  swapDirection?: 'exactAmountIn' | 'exactAmountOut',
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

  // For SELL operations, support automatic 100% balance selling
  let effectiveAmount = amount;
  if (side === 'SELL' && (amount <= 0 || amount === -1)) {
    // Get current balance of the base token (what we're selling)
    const balances = await solana.getBalance(wallet, [baseToken]);
    const baseTokenBalance = balances[baseToken] || 0;
    
    if (baseTokenBalance <= 0) {
      throw fastify.httpErrors.badRequest(`No ${baseToken} balance to sell`);
    }
    
    effectiveAmount = baseTokenBalance;
    logger.info(
      `⚡ ULTRA-FAST SELL: Automatically selling 100% of ${baseToken} balance (${effectiveAmount.toFixed(6)})`,
    );
  }

  logger.info(
    `Executing optimized ${effectiveAmount.toFixed(4)} ${side} swap in pool ${poolAddress}`,
  );

  // Pre-assemble the transaction
  const preAssemblyManager = new PreAssemblyManager(raydium, solana);
  const transaction = await preAssemblyManager.preAssembleSwap(
    poolAddress,
    baseToken,
    quoteToken,
    effectiveAmount,
    side,
    effectiveSlippage,
    swapDirection,
  );

  if (!transaction) {
    throw new Error('Failed to pre-assemble swap transaction');
  }

  // Sign and execute the transaction
  transaction.sign([wallet]);
  
  // Skip simulation for SELL orders to enable ultra-fast exits
  if (side !== 'SELL') {
    await solana.simulateTransaction(transaction as VersionedTransaction);
  } else {
    logger.info(
      '⚡ ULTRA-FAST SELL: Skipping transaction simulation for faster execution',
    );
  }

  // Use optimized confirmation for SELL orders
  const { confirmed, signature, txData } = side === 'SELL'
    ? await solana.sendAndConfirmRawTransactionSELL(transaction)
    : await solana.sendAndConfirmRawTransaction(transaction);

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

    return addPSTTimestamp({
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
    
    });
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
            swapDirection: { type: 'string', examples: ['exactAmountIn'] },
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
          swapDirection,
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
          swapDirection as 'exactAmountIn' | 'exactAmountOut' | undefined,
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
