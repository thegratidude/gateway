import { VersionedTransaction, PublicKey } from '@solana/web3.js';
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

import { getRawSwapQuoteDirect } from './quoteSwapDirect';

async function executeSwapDirect(
  fastify: FastifyInstance,
  network: string,
  walletAddress: string,
  baseTokenMint: string,
  quoteTokenMint: string,
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

  // Validate that the provided mint addresses match the pool
  if (
    poolInfo.baseTokenAddress !== baseTokenMint &&
    poolInfo.quoteTokenAddress !== baseTokenMint
  ) {
    throw fastify.httpErrors.badRequest(
      `Base token mint ${baseTokenMint} does not match pool tokens`,
    );
  }

  if (
    poolInfo.baseTokenAddress !== quoteTokenMint &&
    poolInfo.quoteTokenAddress !== quoteTokenMint
  ) {
    throw fastify.httpErrors.badRequest(
      `Quote token mint ${quoteTokenMint} does not match pool tokens`,
    );
  }

  // Use configured slippage if not provided
  const effectiveSlippage = slippagePct || raydium.getSlippagePct();

  // Get swap quote
  const quote = await getRawSwapQuoteDirect(
    raydium,
    network,
    poolAddress,
    baseTokenMint,
    quoteTokenMint,
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
      if (side === 'BUY') {
        // AMM swap base out (exact output)
        ({ transaction } = (await raydium.raydiumSDK.liquidity.swap({
          poolInfo: quote.poolInfo,
          poolKeys: quote.poolKeys,
          amountIn: quote.maxAmountIn,
          amountOut: new BN(quote.amountOut),
          fixedSide: 'out',
          inputMint: inputToken.address,
          txVersion: raydium.txVersion,
          computeBudgetConfig: {
            units: COMPUTE_UNITS,
            microLamports: priorityFeePerCU,
          },
        })) as { transaction: VersionedTransaction });
      } else {
        // AMM swap (exact input)
        ({ transaction } = (await raydium.raydiumSDK.liquidity.swap({
          poolInfo: quote.poolInfo,
          poolKeys: quote.poolKeys,
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
      }
    } else if (poolInfo.poolType === 'cpmm') {
      if (side === 'BUY') {
        // CPMM swap base out (exact output)
        ({ transaction } = (await raydium.raydiumSDK.cpmm.swap({
          poolInfo: quote.poolInfo,
          poolKeys: quote.poolKeys,
          inputAmount: new BN(0), // not used when fixedOut is true
          fixedOut: true,
          swapResult: {
            sourceAmountSwapped: quote.amountIn,
            destinationAmountSwapped: new BN(quote.amountOut),
          },
          slippage: effectiveSlippage / 100,
          baseIn: inputToken.address === quote.poolInfo.mintA.address,
          txVersion: raydium.txVersion,
          computeBudgetConfig: {
            units: COMPUTE_UNITS,
            microLamports: priorityFeePerCU,
          },
        })) as { transaction: VersionedTransaction });
      } else {
        // CPMM swap (exact input)
        ({ transaction } = (await raydium.raydiumSDK.cpmm.swap({
          poolInfo: quote.poolInfo,
          poolKeys: quote.poolKeys,
          inputAmount: quote.amountIn,
          swapResult: {
            sourceAmountSwapped: quote.amountIn,
            destinationAmountSwapped: quote.amountOut,
          },
          slippage: effectiveSlippage / 100,
          baseIn: inputToken.address === quote.poolInfo.mintA.address,
          txVersion: raydium.txVersion,
          computeBudgetConfig: {
            units: COMPUTE_UNITS,
            microLamports: priorityFeePerCU,
          },
        })) as { transaction: VersionedTransaction });
      }
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
          inputToken,
          outputToken,
          wallet.publicKey.toBase58(),
        );

      logger.info(
        `Swap executed successfully: ${Math.abs(side === 'SELL' ? baseTokenBalanceChange : quoteTokenBalanceChange).toFixed(4)} ${inputToken.symbol} -> ${Math.abs(side === 'SELL' ? quoteTokenBalanceChange : baseTokenBalanceChange).toFixed(4)} ${outputToken.symbol}`,
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

export const executeSwapDirectRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: {
      network?: string;
      walletAddress: string;
      poolAddress: string;
      baseTokenMint: string;
      quoteTokenMint: string;
      amount: number;
      side: 'BUY' | 'SELL';
      slippagePct?: number;
    };
    Reply: ExecuteSwapResponseType;
  }>(
    '/execute-swap-direct',
    {
      schema: {
        description: 'Execute swap on Raydium AMM using direct mint addresses',
        tags: ['raydium/amm'],
        body: {
          type: 'object',
          properties: {
            network: { type: 'string', default: 'mainnet-beta' },
            walletAddress: {
              type: 'string',
              examples: ['your_wallet_address'],
            },
            poolAddress: {
              type: 'string',
              examples: ['58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'],
            },
            baseTokenMint: {
              type: 'string',
              examples: ['So11111111111111111111111111111111111111112'],
            },
            quoteTokenMint: {
              type: 'string',
              examples: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
            },
            amount: { type: 'number', examples: [0.01] },
            side: { type: 'string', enum: ['BUY', 'SELL'], examples: ['SELL'] },
            slippagePct: { type: 'number', examples: [1.0] },
          },
          required: [
            'walletAddress',
            'poolAddress',
            'baseTokenMint',
            'quoteTokenMint',
            'amount',
            'side',
          ],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              signature: { type: 'string' },
              totalInputSwapped: { type: 'number' },
              totalOutputSwapped: { type: 'number' },
              fee: { type: 'number' },
              baseTokenBalanceChange: { type: 'number' },
              quoteTokenBalanceChange: { type: 'number' },
            },
          },
        },
      },
    },
    async (request) => {
      try {
        const {
          network,
          walletAddress,
          poolAddress,
          baseTokenMint,
          quoteTokenMint,
          amount,
          side,
          slippagePct,
        } = request.body;
        const networkToUse = network || 'mainnet-beta';

        // Validate mint addresses and pool address
        try {
          new PublicKey(baseTokenMint);
          new PublicKey(quoteTokenMint);
          new PublicKey(poolAddress);
          new PublicKey(walletAddress);
        } catch (error) {
          throw fastify.httpErrors.badRequest(
            'Invalid mint address, pool address, or wallet address',
          );
        }

        return await executeSwapDirect(
          fastify,
          networkToUse,
          walletAddress,
          baseTokenMint,
          quoteTokenMint,
          amount,
          side as 'BUY' | 'SELL',
          poolAddress,
          slippagePct,
        );
      } catch (e) {
        logger.error(e);
        if (e.statusCode) {
          throw e;
        }
        throw fastify.httpErrors.internalServerError('Swap execution failed');
      }
    },
  );
};
