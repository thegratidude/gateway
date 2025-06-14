# Raydium AMM Amount Input vs Output Analysis

## Problem Summary

The test was configured to buy **0.001 SOL worth of RAY tokens** (amount IN), but the implementation was actually buying **0.001 RAY tokens** (amount OUT). This explains the massive amount discrepancy:

- **Configured**: 0.001 SOL (amount IN)
- **Actual**: 0.069965 SOL (amount IN for 0.001 RAY tokens OUT)

## Root Cause Analysis

### 1. Side-to-ExactIn Mapping Issue

**Location**: `gateway/src/connectors/raydium/amm-routes/quoteSwap.ts:262`

```typescript
// Convert side to exactIn
const exactIn = side === 'SELL';
```

**Problem**: This mapping is **incorrect** for the intended behavior.

**Current Logic**:
- `SELL` → `exactIn = true` (we know input amount)
- `BUY` → `exactIn = false` (we know output amount)

**Expected Logic**:
- `SELL` → `exactIn = true` (we know input amount) ✅
- `BUY` → `exactIn = true` (we know input amount) ❌ **WRONG**

### 2. Amount Calculation Logic

**Location**: `gateway/src/connectors/raydium/amm-routes/quoteSwap.ts:330-340`

```typescript
// Create amount with proper decimals for the token being used (input for exactIn, output for exactOut)
const amountInWithDecimals = exactIn
  ? new Decimal(amount).mul(10 ** inputDecimals).toFixed(0)
  : undefined;

const amountOutWithDecimals = !exactIn
  ? new Decimal(amount).mul(10 ** outputDecimals).toFixed(0)
  : undefined;
```

**Problem**: For BUY orders, this creates `amountOutWithDecimals` instead of `amountInWithDecimals`.

### 3. Token Resolution Logic

**Location**: `gateway/src/connectors/raydium/amm-routes/quoteSwap.ts:310-315`

```typescript
// Determine which token is input and which is output based on exactIn flag
const [inputToken, outputToken] = exactIn
  ? [resolvedBaseToken, resolvedQuoteToken]
  : [resolvedQuoteToken, resolvedBaseToken];
```

**Problem**: For BUY orders, this swaps the input/output tokens incorrectly.

## Expected vs Actual Behavior

### Expected Behavior (Amount IN)
```
BUY 0.001 SOL worth of RAY:
- Input: 0.001 SOL (known amount)
- Output: ~X RAY tokens (calculated)
- exactIn: true
- inputToken: SOL
- outputToken: RAY
```

### Actual Behavior (Amount OUT)
```
BUY 0.001 RAY tokens:
- Input: ~0.069965 SOL (calculated)
- Output: 0.001 RAY (known amount)
- exactIn: false
- inputToken: RAY (wrong!)
- outputToken: SOL (wrong!)
```

## Comparison with Other Connectors

### Jupiter (Correct Implementation)
**Location**: `gateway/src/connectors/jupiter/routes/quoteSwap.ts:63-85`

```typescript
if (tradeSide === 'BUY') {
  // BUY orders use ExactOut mode
  quote = await jupiter.getQuote(
    quoteTokenInfo.address,
    baseTokenInfo.address,
    amountValue,
    slippagePct,
    false,
    false,
    'ExactOut',
  );
} else {
  // SELL order - standard ExactIn
  quote = await jupiter.getQuote(
    baseTokenInfo.address,
    quoteTokenInfo.address,
    amountValue,
    slippagePct,
    false,
    false,
    'ExactIn',
  );
}
```

**Jupiter Logic**:
- `BUY` → `ExactOut` (we know output amount)
- `SELL` → `ExactIn` (we know input amount)

### Meteora (Correct Implementation)
**Location**: `gateway/src/connectors/meteora/clmm-routes/quoteSwap.ts:45-55`

```typescript
// For buy orders, we're swapping quote token for base token (ExactOut)
// For sell orders, we're swapping base token for quote token (ExactIn)
const [inputToken, outputToken] =
  side === 'BUY' ? [quoteToken, baseToken] : [baseToken, quoteToken];

const amount_bn =
  side === 'BUY'
    ? DecimalUtil.toBN(new Decimal(amount), outputToken.decimals)
    : DecimalUtil.toBN(new Decimal(amount), inputToken.decimals);
```

**Meteora Logic**:
- `BUY` → `ExactOut` (amount in output token decimals)
- `SELL` → `ExactIn` (amount in input token decimals)

## The Fix

### Option 1: Change to Amount IN (Recommended)
Make BUY orders use `exactIn` like SELL orders, so users specify the input amount.

**Fix**:
```typescript
// Convert side to exactIn - both BUY and SELL use exactIn
const exactIn = true; // Always use exactIn for consistent behavior

// Determine which token is input and which is output
const [inputToken, outputToken] = side === 'BUY' 
  ? [resolvedQuoteToken, resolvedBaseToken]  // BUY: quote token in, base token out
  : [resolvedBaseToken, resolvedQuoteToken]; // SELL: base token in, quote token out

// Always use amountInWithDecimals
const amountInWithDecimals = new Decimal(amount).mul(10 ** inputToken.decimals).toFixed(0);
```

### Option 2: Keep Amount OUT but Fix Implementation
Keep BUY orders as `exactOut` but fix the token resolution.

**Fix**:
```typescript
// Convert side to exactIn
const exactIn = side === 'SELL';

// Determine which token is input and which is output based on exactIn flag
const [inputToken, outputToken] = exactIn
  ? [resolvedBaseToken, resolvedQuoteToken]  // SELL: base in, quote out
  : [resolvedQuoteToken, resolvedBaseToken]; // BUY: quote in, base out (FIXED)

// Create amount with proper decimals
const amountInWithDecimals = exactIn
  ? new Decimal(amount).mul(10 ** inputDecimals).toFixed(0)
  : undefined;

const amountOutWithDecimals = !exactIn
  ? new Decimal(amount).mul(10 ** outputDecimals).toFixed(0)
  : undefined;
```

## Recommendation

**Use Option 1 (Amount IN)** because:

1. **Consistency**: Both BUY and SELL use the same `exactIn` logic
2. **User Expectation**: Users typically think in terms of "how much SOL do I want to spend?"
3. **Simpler Logic**: Reduces complexity and potential for errors
4. **Industry Standard**: Most DEX interfaces work this way

## Implementation Plan

### 1. Fix Quote Calculation
**File**: `gateway/src/connectors/raydium/amm-routes/quoteSwap.ts`

```typescript
export async function getRawSwapQuote(
  raydium: Raydium,
  network: string,
  poolId: string,
  baseToken: string,
  quoteToken: string,
  amount: number,
  side: 'BUY' | 'SELL',
  slippagePct?: number,
): Promise<any> {
  // Always use exactIn for consistent behavior
  const exactIn = true;

  logger.info(
    `getRawSwapQuote: poolId=${poolId}, baseToken=${baseToken}, quoteToken=${quoteToken}, amount=${amount}, side=${side}, exactIn=${exactIn}`,
  );

  // ... pool info and token resolution ...

  // Determine which token is input and which is output
  const [inputToken, outputToken] = side === 'BUY' 
    ? [resolvedQuoteToken, resolvedBaseToken]  // BUY: quote token in, base token out
    : [resolvedBaseToken, resolvedQuoteToken]; // SELL: base token in, quote token out

  // Always use amountInWithDecimals
  const amountInWithDecimals = new Decimal(amount).mul(10 ** inputToken.decimals).toFixed(0);

  logger.info(`Amount in human readable: ${amount}`);
  logger.info(`Amount in with decimals: ${amountInWithDecimals}`);

  // ... rest of implementation ...
}
```

### 2. Fix Execution Logic
**File**: `gateway/src/connectors/raydium/amm-routes/executeSwapOptimized.ts`

```typescript
// Build transaction based on pool type
if (poolInfo.poolType === 'amm') {
  // Always use exact input for consistent behavior
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
}
```

### 3. Update Tests
**File**: `gateway/examples/round-trip-swap-test.ts`

Remove the quote bypass and use proper quote calculation:

```typescript
async function getSwapQuote(
  baseToken: string,
  quoteToken: string,
  amount: number,
  side: 'BUY' | 'SELL',
  poolAddress: string,
): Promise<QuoteResponse> {
  try {
    // Always use proper quote calculation
    const response: AxiosResponse<QuoteResponse> = await axios.get(
      `${GATEWAY_URL}/connectors/raydium/amm/quote-swap`,
      {
        params: {
          network: NETWORK,
          baseToken: baseToken,
          quoteToken: quoteToken,
          amount: amount,
          side: side,
          slippagePct: SLIPPAGE_PCT,
          poolAddress: poolAddress,
        },
      },
    );

    console.log('Quote Response:', response.data);
    return response.data;
  } catch (error) {
    // ... error handling ...
  }
}
```

## Testing Strategy

### 1. Unit Tests
- Test BUY orders with amount IN
- Test SELL orders with amount IN
- Verify token resolution
- Verify amount calculations

### 2. Integration Tests
- Test round trip swaps
- Verify quote accuracy
- Test different amounts
- Test different token pairs

### 3. Regression Tests
- Ensure existing SELL functionality works
- Test edge cases
- Performance testing

## Expected Results After Fix

### Before Fix
```
BUY 0.001 SOL worth of RAY:
- Actual: 0.069965 SOL → 0.001 RAY (69.965x larger!)
- Quote: 0 tokens (broken)
```

### After Fix
```
BUY 0.001 SOL worth of RAY:
- Actual: 0.001 SOL → ~X RAY tokens
- Quote: ~X RAY tokens (working)
```

## Conclusion

The issue is a fundamental misunderstanding of the BUY/SELL side mapping in the Raydium AMM implementation. The fix is straightforward: make both BUY and SELL orders use `exactIn` for consistent behavior where users specify the input amount.

This will resolve:
1. The amount mismatch (0.001 vs 0.069965 SOL)
2. The zero quote results
3. The high price impact
4. The poor user experience 