import { Type, Static } from '@sinclair/typebox';

// Import the base response schema
import { BaseResponseSchema } from './chain-schema';

export const GetSwapQuoteRequest = Type.Object(
  {
    network: Type.Optional(Type.String()),
    baseToken: Type.String(),
    quoteToken: Type.String(),
    amount: Type.Number(),
    side: Type.String({
      enum: ['BUY', 'SELL'],
      description: 'Trade direction',
    }),
    slippagePct: Type.Optional(Type.Number()),
    poolAddress: Type.Optional(Type.String()),
    swapDirection: Type.Optional(
      Type.String({
        enum: ['exactAmountIn', 'exactAmountOut'],
        description:
          'Swap direction - exactAmountIn for fixed input, exactAmountOut for fixed output',
      }),
    ),
  },
  { $id: 'GetSwapQuoteRequest' },
);
export type GetSwapQuoteRequestType = Static<typeof GetSwapQuoteRequest>;

export const GetSwapQuoteResponse = Type.Intersect([
  BaseResponseSchema,
  Type.Object(
    {
      poolAddress: Type.Optional(Type.String()),
      estimatedAmountIn: Type.Number(),
      estimatedAmountOut: Type.Number(),
      minAmountOut: Type.Number(),
      maxAmountIn: Type.Number(),
      baseTokenBalanceChange: Type.Number(),
      quoteTokenBalanceChange: Type.Number(),
      price: Type.Number(),
      gasPrice: Type.Number(),
      gasLimit: Type.Number(),
      gasCost: Type.Number(),
    },
    { $id: 'GetSwapQuoteResponse' },
  ),
]);
export type GetSwapQuoteResponseType = Static<typeof GetSwapQuoteResponse>;

export const ExecuteSwapRequest = Type.Object(
  {
    network: Type.Optional(Type.String()),
    walletAddress: Type.String(),
    baseToken: Type.String(),
    quoteToken: Type.String(),
    amount: Type.Number(),
    side: Type.String({
      enum: ['BUY', 'SELL'],
      description: 'Trade direction',
    }),
    slippagePct: Type.Optional(Type.Number()),
    poolAddress: Type.Optional(Type.String()),
    swapDirection: Type.Optional(
      Type.String({
        enum: ['exactAmountIn', 'exactAmountOut'],
        description:
          'Swap direction - exactAmountIn for fixed input, exactAmountOut for fixed output',
      }),
    ),
  },
  { $id: 'ExecuteSwapRequest' },
);

export type ExecuteSwapRequestType = Static<typeof ExecuteSwapRequest>;

export const ExecuteSwapResponse = Type.Intersect([
  BaseResponseSchema,
  Type.Object(
    {
      signature: Type.String(),
      totalInputSwapped: Type.Number(),
      totalOutputSwapped: Type.Number(),
      fee: Type.Number(),
      baseTokenBalanceChange: Type.Number(),
      quoteTokenBalanceChange: Type.Number(),
    },
    { $id: 'ExecuteSwapResponse' },
  ),
]);
export type ExecuteSwapResponseType = Static<typeof ExecuteSwapResponse>;
