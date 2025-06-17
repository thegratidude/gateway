import { VersionedTransaction } from '@solana/web3.js';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import { FastifyPluginAsync, FastifyInstance } from 'fastify';

import { Solana, BASE_FEE } from '../../../chains/solana/solana';
import {
  ExecuteSwapResponse,
  ExecuteSwapResponseType,
  ExecuteSwapRequest,
  ExecuteSwapRequestType,
} from '../../../schemas/swap-schema';
import { logger, addPSTTimestamp } from '../../../services/logger';
import { Raydium } from '../raydium';

import { getRawSwapQuote } from './quoteSwap';

async function executeSwap(
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

  // Get pool info from address
  const poolInfo = await raydium.getAmmPoolInfo(poolAddress);
  if (!poolInfo) {
    throw fastify.httpErrors.notFound(`Pool not found: ${poolAddress}`);
  }

  // Use configured slippage if not provided
  const effectiveSlippage = slippagePct || raydium.getSlippagePct();

  // CRITICAL OPTIMIZATION: For SELL orders, skip external quote calculation
  // This enables ultra-fast exits by pre-packaging instructions and calculating
  // the quote internally during execution. This is the core optimization
  // that provides the fastest possible exit times for SELL orders.
  if (side === 'SELL') {
    logger.info(
      'Using optimized SELL execution - skipping external quote for ultra-fast exit',
    );

    // For SELL orders, we bypass the external quote step and calculate
    // the quote internally during transaction building. This eliminates
    // one round-trip and enables pre-packaging of instructions.

    const inputToken = await solana.getToken(baseToken);
    const outputToken = await solana.getToken(quoteToken);

    logger.info(
      `Executing optimized ${amount.toFixed(4)} ${side} swap in pool ${poolAddress}`,
    );

    const COMPUTE_UNITS = 600000;
    let currentPriorityFee = (await solana.estimateGas()) * 1e9 - BASE_FEE;
    while (currentPriorityFee <= solana.config.maxPriorityFee * 1e9) {
      const priorityFeePerCU = Math.floor(
        (currentPriorityFee * 1e6) / COMPUTE_UNITS,
      );
      let transaction: VersionedTransaction;

      // Get transaction based on pool type with internal quote calculation
      if (poolInfo.poolType === 'amm') {
        // AMM swap with internal quote calculation for SELL orders
        const [poolInfoData, poolKeysData] =
          await raydium.getPoolfromAPI(poolAddress);
        const rpcData =
          await raydium.raydiumSDK.liquidity.getRpcPoolInfo(poolAddress);

        // Calculate amount in with proper decimals for SELL (base token in, quote token out)
        const amountIn = new BN(
          Math.floor(amount * Math.pow(10, inputToken.decimals)),
        );

        ({ transaction } = (await raydium.raydiumSDK.liquidity.swap({
          poolInfo: poolInfoData,
          poolKeys: poolKeysData,
          amountIn: amountIn,
          amountOut: new BN(0), // Will be calculated internally by SDK
          fixedSide: 'in',
          inputMint: inputToken.address,
          txVersion: raydium.txVersion,
          computeBudgetConfig: {
            units: COMPUTE_UNITS,
            microLamports: priorityFeePerCU,
          },
        })) as { transaction: VersionedTransaction });
      } else if (poolInfo.poolType === 'cpmm') {
        // CPMM swap with internal quote calculation for SELL orders
        const [poolInfoData, poolKeysData] =
          await raydium.getPoolfromAPI(poolAddress);
        const rpcData = await raydium.raydiumSDK.cpmm.getRpcPoolInfo(
          poolAddress,
          true,
        );
        const baseIn = inputToken.address === poolInfoData.mintA.address;

        // Calculate amount in with proper decimals for SELL
        const amountIn = new BN(
          Math.floor(amount * Math.pow(10, inputToken.decimals)),
        );

        ({ transaction } = (await raydium.raydiumSDK.cpmm.swap({
          poolInfo: poolInfoData,
          poolKeys: poolKeysData,
          inputAmount: amountIn,
          swapResult: {
            sourceAmountSwapped: amountIn,
            destinationAmountSwapped: new BN(0), // Will be calculated internally
          },
          slippage: effectiveSlippage / 100,
          baseIn,
          txVersion: raydium.txVersion,
          computeBudgetConfig: {
            units: COMPUTE_UNITS,
            microLamports: priorityFeePerCU,
          },
        })) as { transaction: VersionedTransaction });
      } else {
        throw new Error(`Unsupported pool type: ${poolInfo.poolType}`);
      }

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
          `Optimized SELL executed successfully: ${Math.abs(baseTokenBalanceChange).toFixed(4)} ${inputToken.symbol} -> ${Math.abs(quoteTokenBalanceChange).toFixed(4)} ${outputToken.symbol}`,
        );

        return addPSTTimestamp({
      signature,
          totalInputSwapped: Math.abs(baseTokenBalanceChange),
          totalOutputSwapped: Math.abs(quoteTokenBalanceChange),
          fee: txData.meta.fee / 1e9,
          baseTokenBalanceChange,
          quoteTokenBalanceChange,
        
    });
      }
      currentPriorityFee =
        currentPriorityFee * solana.config.priorityFeeMultiplier;
      logger.info(
        `Increasing priority fee to ${currentPriorityFee} lamports/CU (max fee of ${(currentPriorityFee / 1e9).toFixed(6)} SOL)`,
      );
    }
    throw new Error(
      `Optimized SELL execution failed after reaching max priority fee of ${(solana.config.maxPriorityFee / 1e9).toFixed(6)} SOL`,
    );
  }

  // For BUY orders, use the standard quote + execution flow
  // This ensures accurate pricing for buy orders while maintaining
  // the ultra-fast exit optimization for sell orders
  logger.info('Using standard BUY execution with external quote');

  // Get quote for BUY orders
  const quote = await getRawSwapQuote(
    raydium,
    network,
    poolAddress,
    baseToken,
    quoteToken,
    amount,
    side,
    effectiveSlippage,
  );

  const inputToken = quote.inputToken;
  const outputToken = quote.outputToken;

  logger.info(
    `Executing ${amount.toFixed(4)} ${side} swap in pool ${poolAddress}`,
  );

  const COMPUTE_UNITS = 600000;
  let currentPriorityFee = (await solana.estimateGas()) * 1e9 - BASE_FEE;
  while (currentPriorityFee <= solana.config.maxPriorityFee * 1e9) {
    const priorityFeePerCU = Math.floor(
      (currentPriorityFee * 1e6) / COMPUTE_UNITS,
    );
    let transaction: VersionedTransaction;

    // Get transaction based on pool type
    if (poolInfo.poolType === 'amm') {
      // AMM swap (exact input) - both BUY and SELL use exactIn
      const [poolInfoData, poolKeysData] =
        await raydium.getPoolfromAPI(poolAddress);
      const rpcData =
        await raydium.raydiumSDK.liquidity.getRpcPoolInfo(poolAddress);

      ({ transaction } = (await raydium.raydiumSDK.liquidity.swap({
        poolInfo: {
          ...poolInfoData,
          baseReserve: rpcData.baseReserve,
          quoteReserve: rpcData.quoteReserve,
          status: rpcData.status.toNumber(),
          version: 4,
        },
        poolKeys: poolKeysData,
        amountIn: new BN(quote.amountIn),
        amountOut: quote.minAmountOut,
        fixedSide: 'in',
        inputMint: inputToken.address,
        txVersion: raydium.txVersion,
        computeBudgetConfig: {
          units: COMPUTE_UNITS,
          microLamports: priorityFeePerCU,
        },
      })) as { transaction: VersionedTransaction });
    } else if (poolInfo.poolType === 'cpmm') {
      // CPMM swap (exact input) - both BUY and SELL use exactIn
      const [poolInfoData, poolKeysData] =
        await raydium.getPoolfromAPI(poolAddress);
      const rpcData = await raydium.raydiumSDK.cpmm.getRpcPoolInfo(
        poolAddress,
        true,
      );
      const baseIn = inputToken.address === poolInfoData.mintA.address;

      ({ transaction } = (await raydium.raydiumSDK.cpmm.swap({
        poolInfo: poolInfoData,
        poolKeys: poolKeysData,
        inputAmount: quote.amountIn,
        swapResult: {
          sourceAmountSwapped: quote.amountIn,
          destinationAmountSwapped: quote.amountOut,
        },
        slippage: effectiveSlippage / 100,
        baseIn,
        txVersion: raydium.txVersion,
        computeBudgetConfig: {
          units: COMPUTE_UNITS,
          microLamports: priorityFeePerCU,
        },
      })) as { transaction: VersionedTransaction });
    } else {
      throw new Error(`Unsupported pool type: ${poolInfo.poolType}`);
    }

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
        `Swap executed successfully: ${Math.abs(baseTokenBalanceChange).toFixed(4)} ${inputToken.symbol} -> ${Math.abs(quoteTokenBalanceChange).toFixed(4)} ${outputToken.symbol}`,
      );

      return addPSTTimestamp({
      signature,
        totalInputSwapped: Math.abs(baseTokenBalanceChange),
        totalOutputSwapped: Math.abs(quoteTokenBalanceChange),
        fee: txData.meta.fee / 1e9,
        baseTokenBalanceChange,
        quoteTokenBalanceChange,
      
    });
    }
    currentPriorityFee =
      currentPriorityFee * solana.config.priorityFeeMultiplier;
    logger.info(
      `Increasing priority fee to ${currentPriorityFee} lamports/CU (max fee of ${(currentPriorityFee / 1e9).toFixed(6)} SOL)`,
    );
  }
  throw new Error(
    `Swap execution failed after reaching max priority fee of ${(solana.config.maxPriorityFee / 1e9).toFixed(6)} SOL`,
  );
}

export const executeSwapRoute: FastifyPluginAsync = async (fastify) => {
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
    '/execute-swap',
    {
      schema: {
        description: 'Execute a swap on Raydium AMM or CPMM',
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

        return await executeSwap(
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
        throw fastify.httpErrors.internalServerError('Swap execution failed');
      }
    },
  );
};

export default executeSwapRoute;
