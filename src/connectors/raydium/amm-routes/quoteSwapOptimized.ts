import BN from 'bn.js';
import { FastifyPluginAsync, FastifyInstance } from 'fastify';

import { Solana } from '../../../chains/solana/solana';
import {
  GetSwapQuoteResponse,
  GetSwapQuoteResponseType,
  GetSwapQuoteRequest,
  GetSwapQuoteRequestType,
} from '../../../schemas/swap-schema';
import { logger } from '../../../services/logger';
import { Raydium } from '../raydium';

import { getRawSwapQuote } from './quoteSwap';

async function quoteSwapOptimized(
  fastify: FastifyInstance,
  network: string,
  baseToken: string,
  quoteToken: string,
  amount: number,
  side: 'BUY' | 'SELL',
  poolAddress: string,
  slippagePct?: number,
): Promise<GetSwapQuoteResponseType> {
  const raydium = await Raydium.getInstance(network);

  // Use configured slippage if not provided
  const effectiveSlippage = slippagePct || raydium.getSlippagePct();

  // Check cache first
  const cachedQuote = raydium.getCachedQuote(
    poolAddress,
    baseToken,
    quoteToken,
    amount,
    side,
    effectiveSlippage,
  );

  if (cachedQuote) {
    logger.info('Using cached quote for faster response');
    return cachedQuote;
  }

  // Get pool info (cached)
  const poolInfo = await raydium.getAmmPoolInfo(poolAddress);
  if (!poolInfo) {
    throw fastify.httpErrors.notFound(`Pool not found: ${poolAddress}`);
  }

  // Get raw quote
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

  // Calculate amounts based on side
  let inputAmount: number;
  let outputAmount: number;
  let maxInputAmount: number;
  let minOutputAmount: number;

  if (side === 'BUY') {
    // Buying base token with quote token
    inputAmount = Number(quote.amountIn) / 10 ** inputToken.decimals;
    outputAmount = Number(quote.amountOut) / 10 ** outputToken.decimals;
    maxInputAmount = Number(quote.maxAmountIn) / 10 ** inputToken.decimals;
    minOutputAmount = Number(quote.amountOut) / 10 ** outputToken.decimals;
  } else {
    // Selling base token for quote token
    inputAmount = Number(quote.amountIn) / 10 ** inputToken.decimals;
    outputAmount = Number(quote.amountOut) / 10 ** outputToken.decimals;
    maxInputAmount = Number(quote.amountIn) / 10 ** inputToken.decimals;
    minOutputAmount = Number(quote.minAmountOut) / 10 ** outputToken.decimals;
  }

  const response: GetSwapQuoteResponseType = {
    poolAddress,
    estimatedAmountIn: inputAmount,
    estimatedAmountOut: outputAmount,
    minAmountOut: minOutputAmount,
    maxAmountIn: maxInputAmount,
    baseTokenBalanceChange: side === 'BUY' ? outputAmount : -inputAmount,
    quoteTokenBalanceChange: side === 'BUY' ? -inputAmount : outputAmount,
    price:
      side === 'SELL' ? outputAmount / inputAmount : inputAmount / outputAmount,
    gasPrice: 0,
    gasLimit: 0,
    gasCost: 0,
  };

  // Cache the quote
  raydium.setCachedQuote(
    poolAddress,
    baseToken,
    quoteToken,
    amount,
    side,
    effectiveSlippage,
    response,
  );

  return response;
}

export const quoteSwapOptimizedRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: GetSwapQuoteRequestType;
    Reply: GetSwapQuoteResponseType;
  }>(
    '/quote-swap-optimized',
    {
      schema: {
        description:
          'Get an optimized quote for a swap on Raydium AMM or CPMM with caching',
        tags: ['raydium/amm'],
        body: {
          ...GetSwapQuoteRequest,
          properties: {
            ...GetSwapQuoteRequest.properties,
            network: { type: 'string', default: 'mainnet-beta' },
            baseToken: { type: 'string', examples: ['SOL'] },
            quoteToken: { type: 'string', examples: ['USDC'] },
            amount: { type: 'number', examples: [0.01] },
            side: { type: 'string', examples: ['SELL'] },
            poolAddress: { type: 'string', examples: [''] },
            slippagePct: { type: 'number', examples: [1] },
          },
        },
        response: { 200: GetSwapQuoteResponse },
      },
    },
    async (request) => {
      try {
        const {
          network,
          baseToken,
          quoteToken,
          amount,
          side,
          poolAddress,
          slippagePct,
        } = request.body;
        const networkToUse = network || 'mainnet-beta';
        const raydium = await Raydium.getInstance(networkToUse);

        // If no pool address provided, find default pool
        let poolAddressToUse = poolAddress;
        if (!poolAddressToUse) {
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

        return await quoteSwapOptimized(
          fastify,
          networkToUse,
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
          'Failed to get optimized quote',
        );
      }
    },
  );
};
