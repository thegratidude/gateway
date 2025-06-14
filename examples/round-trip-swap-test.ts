import dotenv from 'dotenv';
import axios, { AxiosResponse } from 'axios';
import path from 'path';

// Load environment variables from the gateway directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Type definitions
interface BalanceResponse {
  balances: Record<string, number>;
}

interface QuoteResponse {
  poolAddress: string;
  estimatedAmountIn: number;
  estimatedAmountOut: number;
  minAmountOut: number;
  maxAmountIn: number;
  baseTokenBalanceChange: number;
  quoteTokenBalanceChange: number;
  price: number;
  gasPrice: number;
  gasLimit: number;
  gasCost: number;
}

interface SwapExecuteResponse {
  signature: string;
  totalInputSwapped: number;
  totalOutputSwapped: number;
  fee: number;
  baseTokenBalanceChange: number;
  quoteTokenBalanceChange: number;
}

interface TransactionStatus {
  status: string;
  [key: string]: any;
}

interface RoundTripResult {
  buyTransaction: string;
  sellTransaction: string;
  buyDetails: SwapExecuteResponse;
  sellDetails: SwapExecuteResponse;
  initialBalances: Record<string, number>;
  finalBalances: Record<string, number>;
  buyProcessTime: number;
  sellProcessTime: number;
  totalProcessTime: number;
  summary: {
    solChange: number;
    tokenChange: number;
    totalFees: number;
  };
}

// Configuration from environment variables
const GATEWAY_URL: string = process.env.GATEWAY_URL || 'http://localhost:15888';
const NETWORK: string = process.env.NETWORK || 'mainnet-beta';
const WALLET_ADDRESS: string | undefined = process.env.WALLET_ADDRESS;
const POOL_ADDRESS: string | undefined = process.env.POOL_ADDRESS;
const TOKEN_ADDRESS: string | undefined = process.env.TOKEN_ADDRESS;

// Constants for the test
const BUY_AMOUNT_SOL: number = parseFloat(
  process.env.BUY_AMOUNT_SOL || '0.001',
);
const SLIPPAGE_PCT: number = parseFloat(process.env.SLIPPAGE_PCT || '1.0');
const WAIT_TIME_MS: number = parseInt(process.env.WAIT_TIME_MS || '10000');

/**
 * Check wallet balances
 */
async function checkBalances(
  walletAddress: string,
  tokens: string[] = ['SOL'],
): Promise<Record<string, number>> {
  try {
    const response: AxiosResponse<BalanceResponse> = await axios.post(
      `${GATEWAY_URL}/chains/solana/balances`,
      {
        network: NETWORK,
        address: walletAddress,
        tokens: tokens,
      },
    );

    console.log('Balance Response:', response.data);
    return response.data.balances;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        'Error checking balances:',
        error.response?.data || error.message,
      );
    } else {
      console.error('Error checking balances:', error);
    }
    throw error;
  }
}

/**
 * Get swap quote
 */
async function getSwapQuote(
  baseToken: string,
  quoteToken: string,
  amount: number,
  side: 'BUY' | 'SELL',
  poolAddress: string,
): Promise<QuoteResponse> {
  try {
    // For SELL orders, use optimized endpoint that skips external quote
    if (side === 'SELL') {
      console.log('   Using optimized quote calculation for SELL order...');
      // For SELL orders, we'll get the quote from the optimized execution
      // Return a minimal quote structure
      return {
        poolAddress: poolAddress,
        estimatedAmountIn: amount,
        estimatedAmountOut: 0, // Will be calculated during execution
        minAmountOut: 0,
        maxAmountIn: amount,
        baseTokenBalanceChange: -amount,
        quoteTokenBalanceChange: 0,
        price: 0,
        gasPrice: 0.5,
        gasLimit: 200000,
        gasCost: 0.000105
      };
    }

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
    if (axios.isAxiosError(error)) {
      console.error(
        'Error getting quote:',
        error.response?.data || error.message,
      );
    } else {
      console.error('Error getting quote:', error);
    }
    throw error;
  }
}

/**
 * Execute swap
 */
async function executeSwap(
  walletAddress: string,
  baseToken: string,
  quoteToken: string,
  amount: number,
  side: 'BUY' | 'SELL',
  poolAddress: string,
): Promise<SwapExecuteResponse> {
  try {
    // Use optimized endpoint for better performance and pre-packaging
    const endpoint = `${GATEWAY_URL}/connectors/raydium/amm/execute-swap-optimized`;
    
    console.log(`   Using optimized endpoint: ${endpoint}`);
    console.log(`   Pre-packaging instructions for ${side} order...`);

    const response: AxiosResponse<SwapExecuteResponse> = await axios.post(
      endpoint,
      {
        network: NETWORK,
        walletAddress: walletAddress,
        baseToken: baseToken,
        quoteToken: quoteToken,
        amount: amount,
        side: side,
        slippagePct: SLIPPAGE_PCT,
        poolAddress: poolAddress,
      },
    );

    console.log('Swap Execution Response:', response.data);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        'Error executing swap:',
        error.response?.data || error.message,
      );
    } else {
      console.error('Error executing swap:', error);
    }
    throw error;
  }
}

/**
 * Monitor transaction status
 */
async function monitorTransaction(
  signature: string,
): Promise<TransactionStatus> {
  try {
    const response: AxiosResponse<TransactionStatus> = await axios.post(
      `${GATEWAY_URL}/chains/solana/poll`,
      {
        network: NETWORK,
        signature: signature,
      },
    );

    console.log('Transaction Status:', response.data);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        'Error monitoring transaction:',
        error.response?.data || error.message,
      );
    } else {
      console.error('Error monitoring transaction:', error);
    }
    throw error;
  }
}

/**
 * Wait for specified milliseconds
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute round trip swap test
 */
async function executeRoundTripSwap(): Promise<RoundTripResult> {
  console.log('=== Raydium AMM Round Trip Swap Test ===\n');

  // Validate required parameters
  if (!WALLET_ADDRESS || WALLET_ADDRESS === 'your-solana-wallet-address-here') {
    throw new Error('Please set WALLET_ADDRESS in your .env file');
  }
  if (!POOL_ADDRESS || POOL_ADDRESS === 'your-pool-address-here') {
    throw new Error('Please set POOL_ADDRESS in your .env file');
  }
  if (!TOKEN_ADDRESS || TOKEN_ADDRESS === 'your-token-address-here') {
    throw new Error('Please set TOKEN_ADDRESS in your .env file');
  }

  console.log('Configuration:');
  console.log(`  Wallet Address: ${WALLET_ADDRESS}`);
  console.log(`  Pool Address: ${POOL_ADDRESS}`);
  console.log(`  Token Address: ${TOKEN_ADDRESS}`);
  console.log(`  Buy Amount: ${BUY_AMOUNT_SOL} SOL`);
  console.log(`  Slippage: ${SLIPPAGE_PCT}%`);
  console.log(`  Wait Time: ${WAIT_TIME_MS / 1000} seconds\n`);

  try {
    // Step 1: Check initial balances
    console.log('1. Checking initial balances...');
    const initialBalances = await checkBalances(WALLET_ADDRESS, [
      'SOL',
      TOKEN_ADDRESS,
    ]);

    const initialSolBalance: number = initialBalances.SOL || 0;
    const initialTokenBalance: number = initialBalances[TOKEN_ADDRESS] || 0;

    console.log(`   Initial SOL Balance: ${initialSolBalance}`);
    console.log(`   Initial Token Balance: ${initialTokenBalance}\n`);

    // Check if we have enough SOL for the buy
    if (initialSolBalance < BUY_AMOUNT_SOL + 0.01) {
      // Extra 0.01 for fees
      throw new Error(
        `Insufficient SOL balance. Need at least ${BUY_AMOUNT_SOL + 0.01} SOL, have ${initialSolBalance}`,
      );
    }

    // Start timing for buy process
    const buyStartTime = Date.now();

    // Step 2: Get buy quote
    console.log('2. Getting buy quote...');
    const buyQuote = await getSwapQuote(
      'SOL', // baseToken (selling SOL)
      TOKEN_ADDRESS, // quoteToken (buying token)
      BUY_AMOUNT_SOL, // amount
      'SELL', // side (selling SOL to get token)
      POOL_ADDRESS,
    );

    console.log(`   Expected to receive: ${buyQuote.estimatedAmountOut} tokens`);
    console.log(`   Price: ${buyQuote.price} SOL per token\n`);

    // Step 3: Execute buy
    console.log('3. Executing buy transaction...');
    const buyResult = await executeSwap(
      WALLET_ADDRESS,
      'SOL',           // baseToken
      TOKEN_ADDRESS,   // quoteToken
      BUY_AMOUNT_SOL,  // amount
      'SELL',          // side
      POOL_ADDRESS
    );

    console.log(`   Buy Transaction Hash: ${buyResult.signature}`);
    console.log(`   SOL Spent: ${buyResult.totalInputSwapped}`);
    console.log(`   Tokens Received: ${buyResult.totalOutputSwapped}`);
    console.log(`   Transaction Fee: ${buyResult.fee} SOL\n`);

    // Step 4: Monitor buy transaction
    console.log('4. Monitoring buy transaction...');
    const buyTxStatus = await monitorTransaction(buyResult.signature);
    console.log(`   Buy Transaction Status: ${JSON.stringify(buyTxStatus)}\n`);

    // End timing for buy process
    const buyEndTime = Date.now();
    const buyProcessTime = buyEndTime - buyStartTime;

    // Step 5: Wait 10 seconds
    console.log(`5. Waiting ${WAIT_TIME_MS / 1000} seconds...`);
    await wait(WAIT_TIME_MS);
    console.log('   Wait complete\n');

    // Step 6: Check balances after buy
    console.log('6. Checking balances after buy...');
    const afterBuyBalances = await checkBalances(WALLET_ADDRESS, ['SOL', TOKEN_ADDRESS]);
    
    const afterBuySolBalance: number = afterBuyBalances.SOL || 0;
    // Check for both the token address and the symbol (RAY)
    const afterBuyTokenBalance: number = afterBuyBalances[TOKEN_ADDRESS] || afterBuyBalances.RAY || 0;
    
    console.log(`   SOL Balance: ${afterBuySolBalance}`);
    console.log(`   Token Balance: ${afterBuyTokenBalance}`);
    console.log(`   Full balance response:`, afterBuyBalances);
    
    // Use the actual balance after buy transaction to ensure we sell 100% of tokens
    const actualTokensReceived = buyResult.totalOutputSwapped;
    const actualTokenBalance = afterBuyTokenBalance;
    
    console.log(`   Actual tokens received from transaction: ${actualTokensReceived}`);
    console.log(`   Actual token balance in wallet: ${actualTokenBalance}`);
    
    // Start timing for sell process
    const sellStartTime = Date.now();
    
    // Check if we have tokens to sell
    if (actualTokenBalance <= 0) {
      console.log(`   No tokens to sell. Skipping sell transaction.\n`);
      // End timing for sell process
      const sellEndTime = Date.now();
      const sellProcessTime = sellEndTime - sellStartTime;
      
      // Step 10: Check final balances
      console.log('10. Checking final balances...');
      const finalBalances = await checkBalances(WALLET_ADDRESS, ['SOL', TOKEN_ADDRESS]);
      
      const finalSolBalance: number = finalBalances.SOL || 0;
      const finalTokenBalance: number = finalBalances[TOKEN_ADDRESS] || finalBalances.RAY || 0;
      
      console.log(`   Final SOL Balance: ${finalSolBalance}`);
      console.log(`   Final Token Balance: ${finalTokenBalance}\n`);
      
      // Step 11: Calculate summary
      console.log('=== TRANSACTION SUMMARY ===');
      console.log(`Buy Transaction Hash: ${buyResult.signature}`);
      console.log(`Sell Transaction: SKIPPED (no tokens to sell)`);
      console.log('');
      console.log('Process Timing:');
      console.log(`  Buy Process: ${buyProcessTime}ms (${(buyProcessTime / 1000).toFixed(2)}s)`);
      console.log(`  Sell Process: ${sellProcessTime}ms (${(sellProcessTime / 1000).toFixed(2)}s)`);
      console.log(`  Total Process: ${buyProcessTime + sellProcessTime}ms (${((buyProcessTime + sellProcessTime) / 1000).toFixed(2)}s)`);
      console.log('');
      console.log('Balance Changes:');
      console.log(`  SOL: ${initialSolBalance} → ${finalSolBalance} (${(finalSolBalance - initialSolBalance).toFixed(6)})`);
      console.log(`  Token: ${initialTokenBalance} → ${finalTokenBalance} (${(finalTokenBalance - initialTokenBalance).toFixed(6)})`);
      console.log('');
      console.log('Transaction Details:');
      console.log(`  Buy: ${buyResult.totalInputSwapped} SOL → ${buyResult.totalOutputSwapped} tokens`);
      console.log(`  Sell: SKIPPED (no tokens to sell)`);
      console.log(`  Total Fees: ${buyResult.fee.toFixed(6)} SOL`);
      console.log(`  Net SOL Change: ${(finalSolBalance - initialSolBalance).toFixed(6)} SOL`);
      console.log('========================');
      
      return {
        buyTransaction: buyResult.signature,
        sellTransaction: 'SKIPPED',
        buyDetails: buyResult,
        sellDetails: null,
        initialBalances,
        finalBalances,
        buyProcessTime,
        sellProcessTime,
        totalProcessTime: buyProcessTime + sellProcessTime,
        summary: {
          solChange: finalSolBalance - initialSolBalance,
          tokenChange: finalTokenBalance - initialTokenBalance,
          totalFees: buyResult.fee
        }
      };
    }
    
    console.log(`   Will sell 100% of balance: ${actualTokenBalance}\n`);

    // Step 7: Get sell quote (sell 100% of token balance)
    // CRITICAL OPTIMIZATION: Skip quote step for SELL orders to enable ultra-fast exits
    // This eliminates one round-trip and enables pre-packaging of instructions
    console.log('7. Getting sell quote...');
    console.log(
      '   ⚡ ULTRA-FAST EXIT: Skipping external quote for SELL order',
    );
    console.log(
      '   ⚡ Quote will be calculated internally during transaction building',
    );
    console.log(
      '   ⚡ This eliminates one round-trip for fastest possible exit',
    );

    // For SELL orders, we skip the external quote entirely
    // The quote calculation happens internally during transaction building
    // This is the core optimization that provides ultra-fast exits
    const sellQuote = {
      poolAddress: POOL_ADDRESS,
      estimatedAmountIn: actualTokenBalance,
      estimatedAmountOut: 0, // Will be calculated internally
      minAmountOut: 0,
      maxAmountIn: actualTokenBalance,
      baseTokenBalanceChange: -actualTokenBalance,
      quoteTokenBalanceChange: 0,
      price: 0, // Will be calculated internally
      gasPrice: 0.5,
      gasLimit: 200000,
      gasCost: 0.000105,
    };

    console.log(
      `   Expected to receive: ${sellQuote.estimatedAmountOut} SOL (calculated internally)`,
    );
    console.log(
      `   Price: ${sellQuote.price} SOL per token (calculated internally)\n`,
    );

    // Step 8: Execute sell
    console.log('8. Executing sell transaction...');
    const sellResult = await executeSwap(
      WALLET_ADDRESS,
      TOKEN_ADDRESS,   // baseToken
      'SOL',           // quoteToken
      actualTokenBalance, // amount (100% of actual balance)
      'SELL',          // side
      POOL_ADDRESS
    );

    console.log(`   Sell Transaction Hash: ${sellResult.signature}`);
    console.log(`   Tokens Sold: ${sellResult.totalInputSwapped}`);
    console.log(`   SOL Received: ${sellResult.totalOutputSwapped}`);
    console.log(`   Transaction Fee: ${sellResult.fee} SOL\n`);

    // Step 9: Monitor sell transaction
    console.log('9. Monitoring sell transaction...');
    const sellTxStatus = await monitorTransaction(sellResult.signature);
    console.log(`   Sell Transaction Status: ${JSON.stringify(sellTxStatus)}\n`);

    // End timing for sell process
    const sellEndTime = Date.now();
    const sellProcessTime = sellEndTime - sellStartTime;

    // Step 10: Check final balances
    console.log('10. Checking final balances...');
    const finalBalances = await checkBalances(WALLET_ADDRESS, ['SOL', TOKEN_ADDRESS]);
    
    const finalSolBalance: number = finalBalances.SOL || 0;
    const finalTokenBalance: number = finalBalances[TOKEN_ADDRESS] || finalBalances.RAY || 0;
    
    console.log(`   Final SOL Balance: ${finalSolBalance}`);
    console.log(`   Final Token Balance: ${finalTokenBalance}\n`);

    // Step 11: Calculate summary
    console.log('=== TRANSACTION SUMMARY ===');
    console.log(`Buy Transaction Hash: ${buyResult.signature}`);
    console.log(`Sell Transaction Hash: ${sellResult.signature}`);
    console.log('');
    console.log('Process Timing:');
    console.log(`  Buy Process: ${buyProcessTime}ms (${(buyProcessTime / 1000).toFixed(2)}s)`);
    console.log(`  Sell Process: ${sellProcessTime}ms (${(sellProcessTime / 1000).toFixed(2)}s)`);
    console.log(`  Total Process: ${buyProcessTime + sellProcessTime}ms (${((buyProcessTime + sellProcessTime) / 1000).toFixed(2)}s)`);
    console.log('');
    console.log('Balance Changes:');
    console.log(`  SOL: ${initialSolBalance} → ${finalSolBalance} (${(finalSolBalance - initialSolBalance).toFixed(6)})`);
    console.log(`  Token: ${initialTokenBalance} → ${finalTokenBalance} (${(finalTokenBalance - initialTokenBalance).toFixed(6)})`);
    console.log('');
    console.log('Transaction Details:');
    console.log(`  Buy: ${buyResult.totalInputSwapped} SOL → ${buyResult.totalOutputSwapped} tokens`);
    console.log(`  Sell: ${sellResult.totalInputSwapped} tokens → ${sellResult.totalOutputSwapped} SOL`);
    console.log(`  Total Fees: ${(buyResult.fee + sellResult.fee).toFixed(6)} SOL`);
    console.log(`  Net SOL Change: ${(finalSolBalance - initialSolBalance).toFixed(6)} SOL`);
    console.log('========================');

    return {
      buyTransaction: buyResult.signature,
      sellTransaction: sellResult.signature,
      buyDetails: buyResult,
      sellDetails: sellResult,
      initialBalances,
      finalBalances,
      buyProcessTime,
      sellProcessTime,
      totalProcessTime: buyProcessTime + sellProcessTime,
      summary: {
        solChange: finalSolBalance - initialSolBalance,
        tokenChange: finalTokenBalance - initialTokenBalance,
        totalFees: buyResult.fee + sellResult.fee
      }
    };

  } catch (error) {
    console.error('Round trip swap test failed:', error instanceof Error ? error.message : error);
    throw error;
  }
}

/**
 * Main function to run the test
 */
async function main(): Promise<RoundTripResult | void> {
  try {
    const result = await executeRoundTripSwap();
    console.log('\nTest completed successfully!');
    return result;
  } catch (error) {
    console.error('\nTest failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Export functions for use in other scripts
export {
  executeRoundTripSwap,
  checkBalances,
  getSwapQuote,
  executeSwap,
  monitorTransaction,
  type RoundTripResult,
  type QuoteResponse,
  type SwapExecuteResponse,
  type TransactionStatus
};

// Run if this file is executed directly
if (require.main === module) {
  main();
} 