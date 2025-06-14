import {
  ApiV3PoolInfoStandardItem,
  ApiV3PoolInfoStandardItemCpmm,
  CurveCalculator,
} from '@raydium-io/raydium-sdk-v2';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import Decimal from 'decimal.js';
import { FastifyPluginAsync, FastifyInstance } from 'fastify';

import { estimateGasSolana } from '../../../chains/solana/routes/estimate-gas';
import { Solana } from '../../../chains/solana/solana';
import {
  GetSwapQuoteResponseType,
  GetSwapQuoteResponse,
  GetSwapQuoteRequestType,
  GetSwapQuoteRequest,
} from '../../../schemas/swap-schema';
import { logger } from '../../../services/logger';
import { Raydium } from '../raydium';

async function quoteAmmSwapDirect(
  raydium: Raydium,
  network: string,
  poolId: string,
  inputMint: string,
  outputMint: string,
  amountIn?: string,
  amountOut?: string,
  slippagePct?: number,
): Promise<any> {
  let poolInfo: ApiV3PoolInfoStandardItem;
  let poolKeys: any;
  let rpcData: any;

  if (network === 'mainnet-beta') {
    const [poolInfoData, poolKeysData] = await raydium.getPoolfromAPI(poolId);
    poolInfo = poolInfoData as ApiV3PoolInfoStandardItem;
    poolKeys = poolKeysData;
    rpcData = await raydium.raydiumSDK.liquidity.getRpcPoolInfo(poolId);
  } else {
    const data = await raydium.raydiumSDK.liquidity.getPoolInfoFromRpc({
      poolId,
    });
    poolInfo = data.poolInfo;
    poolKeys = data.poolKeys;
    rpcData = data.poolRpcData;
  }

  const [baseReserve, quoteReserve, status] = [
    rpcData.baseReserve,
    rpcData.quoteReserve,
    rpcData.status.toNumber(),
  ];

  // Validate that mint addresses match pool tokens
  if (
    poolInfo.mintA.address !== inputMint &&
    poolInfo.mintB.address !== inputMint
  ) {
    throw new Error(`Input mint ${inputMint} does not match pool tokens`);
  }

  if (
    poolInfo.mintA.address !== outputMint &&
    poolInfo.mintB.address !== outputMint
  ) {
    throw new Error(`Output mint ${outputMint} does not match pool tokens`);
  }

  const baseIn = inputMint === poolInfo.mintA.address;
  const [mintIn, mintOut] = baseIn
    ? [poolInfo.mintA, poolInfo.mintB]
    : [poolInfo.mintB, poolInfo.mintA];

  const effectiveSlippage =
    slippagePct === undefined ? 0.01 : slippagePct / 100;

  if (amountIn) {
    const out = raydium.raydiumSDK.liquidity.computeAmountOut({
      poolInfo: {
        ...poolInfo,
        baseReserve,
        quoteReserve,
        status,
        version: 4,
      },
      amountIn: new BN(amountIn),
      mintIn: mintIn.address,
      mintOut: mintOut.address,
      slippage: effectiveSlippage,
    });

    return {
      poolInfo,
      mintIn,
      mintOut,
      amountIn: new BN(amountIn),
      amountOut: out.amountOut,
      minAmountOut: out.minAmountOut,
      maxAmountIn: new BN(amountIn),
      fee: out.fee,
      priceImpact: out.priceImpact,
    };
  } else if (amountOut) {
    const out = raydium.raydiumSDK.liquidity.computeAmountIn({
      poolInfo: {
        ...poolInfo,
        baseReserve,
        quoteReserve,
        status,
        version: 4,
      },
      amountOut: new BN(amountOut),
      mintIn: mintIn.address,
      mintOut: mintOut.address,
      slippage: effectiveSlippage,
    });

    return {
      poolInfo,
      mintIn,
      mintOut,
      amountIn: out.amountIn,
      amountOut: new BN(amountOut),
      minAmountOut: new BN(amountOut),
      maxAmountIn: out.maxAmountIn,
      priceImpact: out.priceImpact,
    };
  }

  throw new Error('Either amountIn or amountOut must be provided');
}

async function quoteCpmmSwapDirect(
  raydium: Raydium,
  network: string,
  poolId: string,
  inputMint: string,
  outputMint: string,
  amountIn?: string,
  amountOut?: string,
  slippagePct?: number,
): Promise<any> {
  let poolInfo: ApiV3PoolInfoStandardItemCpmm;
  let poolKeys: any;
  let rpcData: any;

  if (network === 'mainnet-beta') {
    const [poolInfoData, poolKeysData] = await raydium.getPoolfromAPI(poolId);
    poolInfo = poolInfoData as ApiV3PoolInfoStandardItemCpmm;
    poolKeys = poolKeysData;
    rpcData = await raydium.raydiumSDK.cpmm.getRpcPoolInfo(poolInfo.id, true);
  } else {
    const data = await raydium.raydiumSDK.cpmm.getPoolInfoFromRpc(poolId);
    poolInfo = data.poolInfo;
    poolKeys = data.poolKeys;
    rpcData = data.rpcData;
  }

  // Validate that mint addresses match pool tokens
  if (
    inputMint !== poolInfo.mintA.address &&
    inputMint !== poolInfo.mintB.address
  ) {
    throw new Error(`Input mint ${inputMint} does not match pool tokens`);
  }

  if (
    outputMint !== poolInfo.mintA.address &&
    outputMint !== poolInfo.mintB.address
  ) {
    throw new Error(`Output mint ${outputMint} does not match pool tokens`);
  }

  const baseIn = inputMint === poolInfo.mintA.address;

  if (amountIn) {
    const inputAmount = new BN(amountIn);
    const swapResult = CurveCalculator.swap(
      inputAmount,
      baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
      baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
      rpcData.configInfo!.tradeFeeRate,
    );

    const effectiveSlippage =
      slippagePct === undefined ? 0.01 : slippagePct / 100;
    const minAmountOut = swapResult.destinationAmountSwapped
      .mul(new BN(Math.floor((1 - effectiveSlippage) * 10000)))
      .div(new BN(10000));

    return {
      poolInfo,
      amountIn: inputAmount,
      amountOut: swapResult.destinationAmountSwapped,
      minAmountOut,
      maxAmountIn: inputAmount,
      fee: swapResult.tradeFee,
      priceImpact: null,
      inputMint,
      outputMint,
    };
  } else if (amountOut) {
    const outputAmount = new BN(amountOut);
    const outputMintPk = new PublicKey(outputMint);

    const swapResult = CurveCalculator.swapBaseOut({
      poolMintA: poolInfo.mintA,
      poolMintB: poolInfo.mintB,
      tradeFeeRate: rpcData.configInfo!.tradeFeeRate,
      baseReserve: rpcData.baseReserve,
      quoteReserve: rpcData.quoteReserve,
      outputMint: outputMintPk,
      outputAmount,
    });

    const effectiveSlippage =
      slippagePct === undefined ? 0.01 : slippagePct / 100;
    const maxAmountIn = swapResult.amountIn
      .mul(new BN(Math.floor((1 + effectiveSlippage) * 10000)))
      .div(new BN(10000));

    return {
      poolInfo,
      amountIn: swapResult.amountIn,
      amountOut: outputAmount,
      minAmountOut: outputAmount,
      maxAmountIn,
      fee: swapResult.tradeFee,
      priceImpact: null,
      inputMint,
      outputMint,
    };
  }

  throw new Error('Either amountIn or amountOut must be provided');
}

export async function getRawSwapQuoteDirect(
  raydium: Raydium,
  network: string,
  poolId: string,
  baseTokenMint: string,
  quoteTokenMint: string,
  amount: number,
  side: 'BUY' | 'SELL',
  slippagePct?: number,
): Promise<any> {
  const solana = await Solana.getInstance(network);

  // Get or create token objects for the mint addresses
  const resolvedBaseToken = await solana.getToken(baseTokenMint);
  const resolvedQuoteToken = await solana.getToken(quoteTokenMint);

  if (!resolvedBaseToken || !resolvedQuoteToken) {
    throw new Error(
      `Token not found: ${!resolvedBaseToken ? baseTokenMint : quoteTokenMint}`,
    );
  }

  // Get pool info to validate mint addresses
  const ammPoolInfo = await raydium.getAmmPoolInfo(poolId);
  if (!ammPoolInfo) {
    throw new Error(`Pool not found: ${poolId}`);
  }

  // Validate that the provided mint addresses match the pool
  if (
    ammPoolInfo.baseTokenAddress !== baseTokenMint &&
    ammPoolInfo.quoteTokenAddress !== baseTokenMint
  ) {
    throw new Error(
      `Base token mint ${baseTokenMint} does not match pool tokens`,
    );
  }

  if (
    ammPoolInfo.baseTokenAddress !== quoteTokenMint &&
    ammPoolInfo.quoteTokenAddress !== quoteTokenMint
  ) {
    throw new Error(
      `Quote token mint ${quoteTokenMint} does not match pool tokens`,
    );
  }

  // Determine exactIn vs exactOut based on side
  const exactIn = side === 'SELL'; // SELL = exactIn (we know input amount), BUY = exactOut (we know output amount)

  // Determine which token is input and which is output based on exactIn flag
  const [inputToken, outputToken] = exactIn
    ? [resolvedBaseToken, resolvedQuoteToken]
    : [resolvedQuoteToken, resolvedBaseToken];

  logger.info(
    `Input token: ${inputToken.symbol}, address=${inputToken.address}, decimals=${inputToken.decimals}`,
  );
  logger.info(
    `Output token: ${outputToken.symbol}, address=${outputToken.address}, decimals=${outputToken.decimals}`,
  );

  // Convert amount to string with proper decimals based on which token we're using
  const inputDecimals = inputToken.decimals;
  const outputDecimals = outputToken.decimals;

  // Create amount with proper decimals for the token being used (input for exactIn, output for exactOut)
  const amountInWithDecimals = exactIn
    ? new Decimal(amount).mul(10 ** inputDecimals).toFixed(0)
    : undefined;

  const amountOutWithDecimals = !exactIn
    ? new Decimal(amount).mul(10 ** outputDecimals).toFixed(0)
    : undefined;

  logger.info(`Amount in human readable: ${amount}`);
  logger.info(
    `Amount in with decimals: ${amountInWithDecimals}, Amount out with decimals: ${amountOutWithDecimals}`,
  );

  let result;
  if (ammPoolInfo.poolType === 'amm') {
    result = await quoteAmmSwapDirect(
      raydium,
      network,
      poolId,
      inputToken.address,
      outputToken.address,
      amountInWithDecimals,
      amountOutWithDecimals,
      slippagePct,
    );
  } else if (ammPoolInfo.poolType === 'cpmm') {
    result = await quoteCpmmSwapDirect(
      raydium,
      network,
      poolId,
      inputToken.address,
      outputToken.address,
      amountInWithDecimals,
      amountOutWithDecimals,
      slippagePct,
    );
  } else {
    throw new Error(`Unsupported pool type: ${ammPoolInfo.poolType}`);
  }

  logger.info(
    `Raw quote result: amountIn=${result.amountIn.toString()}, amountOut=${result.amountOut.toString()}, inputMint=${result.inputMint}, outputMint=${result.outputMint}`,
  );

  return {
    ...result,
    inputToken,
    outputToken,
    exactIn,
  };
}

async function formatSwapQuoteDirect(
  _fastify: FastifyInstance,
  network: string,
  poolAddress: string,
  baseTokenMint: string,
  quoteTokenMint: string,
  amount: number,
  side: 'BUY' | 'SELL',
  slippagePct?: number,
): Promise<GetSwapQuoteResponseType> {
  logger.info(
    `formatSwapQuoteDirect: poolAddress=${poolAddress}, baseTokenMint=${baseTokenMint}, quoteTokenMint=${quoteTokenMint}, amount=${amount}, side=${side}`,
  );

  const raydium = await Raydium.getInstance(network);
  const solana = await Solana.getInstance(network);

  // Get or create token objects for the mint addresses
  const resolvedBaseToken = await solana.getToken(baseTokenMint);
  const resolvedQuoteToken = await solana.getToken(quoteTokenMint);

  if (!resolvedBaseToken || !resolvedQuoteToken) {
    throw new Error(
      `Token not found: ${!resolvedBaseToken ? baseTokenMint : quoteTokenMint}`,
    );
  }

  logger.info(
    `Resolved base token: ${resolvedBaseToken.symbol}, address=${resolvedBaseToken.address}, decimals=${resolvedBaseToken.decimals}`,
  );
  logger.info(
    `Resolved quote token: ${resolvedQuoteToken.symbol}, address=${resolvedQuoteToken.address}, decimals=${resolvedQuoteToken.decimals}`,
  );

  // Get pool info
  const poolInfo = await raydium.getAmmPoolInfo(poolAddress);
  if (!poolInfo) {
    throw new Error(`Pool not found: ${poolAddress}`);
  }

  logger.info(
    `Pool info: type=${poolInfo.poolType}, baseToken=${poolInfo.baseTokenAddress}, quoteToken=${poolInfo.quoteTokenAddress}`,
  );

  const quote = await getRawSwapQuoteDirect(
    raydium,
    network,
    poolAddress,
    baseTokenMint,
    quoteTokenMint,
    amount,
    side as 'BUY' | 'SELL',
    slippagePct,
  );

  logger.info(
    `Quote result: amountIn=${quote.amountIn.toString()}, amountOut=${quote.amountOut.toString()}`,
  );

  // Use the token objects returned from getRawSwapQuoteDirect
  const inputToken = quote.inputToken;
  const outputToken = quote.outputToken;

  // Convert amounts to human-readable numbers
  const estimatedAmountIn = new Decimal(quote.amountIn.toString())
    .div(10 ** inputToken.decimals)
    .toNumber();
  const estimatedAmountOut = new Decimal(quote.amountOut.toString())
    .div(10 ** outputToken.decimals)
    .toNumber();
  const minAmountOut = new Decimal(quote.minAmountOut.toString())
    .div(10 ** outputToken.decimals)
    .toNumber();
  const maxAmountIn = new Decimal(quote.maxAmountIn.toString())
    .div(10 ** inputToken.decimals)
    .toNumber();

  // Calculate price
  const price = estimatedAmountOut / estimatedAmountIn;

  // Calculate balance changes based on side
  const baseTokenBalanceChange =
    side === 'BUY' ? estimatedAmountOut : -estimatedAmountIn;
  const quoteTokenBalanceChange =
    side === 'BUY' ? -estimatedAmountIn : estimatedAmountOut;

  return {
    poolAddress,
    estimatedAmountIn,
    estimatedAmountOut,
    minAmountOut,
    maxAmountIn,
    baseTokenBalanceChange,
    quoteTokenBalanceChange,
    price,
    gasPrice: 0,
    gasLimit: 0,
    gasCost: 0,
  };
}

export const quoteSwapDirectRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: {
      network?: string;
      poolAddress: string;
      baseTokenMint: string;
      quoteTokenMint: string;
      amount: number;
      side: 'BUY' | 'SELL';
      slippagePct?: number;
    };
    Reply: GetSwapQuoteResponseType;
  }>(
    '/quote-swap-direct',
    {
      schema: {
        description:
          'Get swap quote for Raydium AMM using direct mint addresses',
        tags: ['raydium/amm'],
        querystring: {
          type: 'object',
          properties: {
            network: { type: 'string', default: 'mainnet-beta' },
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
            slippagePct: { type: 'number', examples: [1] },
          },
          required: [
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
              poolAddress: { type: 'string' },
              estimatedAmountIn: { type: 'number' },
              estimatedAmountOut: { type: 'number' },
              minAmountOut: { type: 'number' },
              maxAmountIn: { type: 'number' },
              baseTokenBalanceChange: { type: 'number' },
              quoteTokenBalanceChange: { type: 'number' },
              price: { type: 'number' },
              gasPrice: { type: 'number' },
              gasLimit: { type: 'number' },
              gasCost: { type: 'number' },
            },
          },
        },
      },
    },
    async (request) => {
      try {
        const {
          network,
          poolAddress,
          baseTokenMint,
          quoteTokenMint,
          amount,
          side,
          slippagePct,
        } = request.query;
        const networkToUse = network || 'mainnet-beta';

        // Validate mint addresses
        try {
          new PublicKey(baseTokenMint);
          new PublicKey(quoteTokenMint);
          new PublicKey(poolAddress);
        } catch (error) {
          throw fastify.httpErrors.badRequest(
            'Invalid mint address or pool address',
          );
        }

        const result = await formatSwapQuoteDirect(
          fastify,
          networkToUse,
          poolAddress,
          baseTokenMint,
          quoteTokenMint,
          amount,
          side as 'BUY' | 'SELL',
          slippagePct,
        );

        let gasEstimation = null;
        try {
          gasEstimation = await estimateGasSolana(fastify, networkToUse);
        } catch (error) {
          logger.warn(
            `Failed to estimate gas for swap quote: ${error.message}`,
          );
        }

        return {
          ...result,
          gasPrice: gasEstimation?.gasPrice,
          gasLimit: gasEstimation?.gasLimit,
          gasCost: gasEstimation?.gasCost,
        };
      } catch (e) {
        logger.error(e);
        if (e.statusCode) {
          throw e;
        }
        throw fastify.httpErrors.internalServerError('Internal server error');
      }
    },
  );
};
