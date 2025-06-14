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
const BUY_AMOUNT_SOL: number = parseFloat(process.env.BUY_AMOUNT_SOL || '0.001');
const SLIPPAGE_PCT: number = parseFloat(process.env.SLIPPAGE_PCT || '1.0');
const WAIT_TIME_MS: number = parseInt(process.env.WAIT_TIME_MS || '10000');

/**
 * Check wallet balances
 */
async function checkBalances(walletAddress: string, tokens: string[] = ['SOL']): Promise<Record<string, number>> {
  try {
    const response: AxiosResponse<BalanceResponse> = await axios.post(`${GATEWAY_URL}/chains/solana/balances`, {
      network: NETWORK,
      address: walletAddress,
      tokens: tokens
    });

    console.log('Balance Response:', response.data);
    return response.data.balances;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Error checking balances:', error.response?.data || error.message);
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
    const response: AxiosResponse<SwapExecuteResponse> = await axios.post(
      `${GATEWAY_URL}/connectors/raydium/amm/execute-swap`,
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
async function monitorTransaction(signature: string): Promise<TransactionStatus> {
  try {
    const response: AxiosResponse<TransactionStatus> = await axios.post(`${GATEWAY_URL}/chains/solana/poll`, {
      network: NETWORK,
      signature: signature
    });

    console.log('Transaction Status:', response.data);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Error monitoring transaction:', error.response?.data || error.message);
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
  return new Promise(resolve => setTimeout(resolve, ms));
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
    const initialBalances = await checkBalances(WALLET_ADDRESS, ['SOL', TOKEN_ADDRESS]);
    
    const initialSolBalance: number = initialBalances.SOL || 0;
    const initialTokenBalance: number = initialBalances[TOKEN_ADDRESS] || 0;
    
    console.log(`   Initial SOL Balance: ${initialSolBalance}`);
    console.log(`   Initial Token Balance: ${initialTokenBalance}\n`);

    // Check if we have enough SOL for the buy
    if (initialSolBalance < BUY_AMOUNT_SOL + 0.01) { // Extra 0.01 for fees
      throw new Error(`Insufficient SOL balance. Need at least ${BUY_AMOUNT_SOL + 0.01} SOL, have ${initialSolBalance}`);
    }

    // Step 2: Get buy quote
    console.log('2. Getting buy quote...');
    const buyQuote = await getSwapQuote(
      'SOL',           // baseToken (selling SOL)
      TOKEN_ADDRESS,   // quoteToken (buying token)
      BUY_AMOUNT_SOL,  // amount
      'SELL',          // side (selling SOL to get token)
      POOL_ADDRESS
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

    // Step 5: Wait 10 seconds
    console.log(`5. Waiting ${WAIT_TIME_MS / 1000} seconds...`);
    await wait(WAIT_TIME_MS);
    console.log('   Wait complete\n');

    // Step 6: Check balances after buy
    console.log('6. Checking balances after buy...');
    const afterBuyBalances = await checkBalances(WALLET_ADDRESS, ['SOL', TOKEN_ADDRESS]);
    
    const afterBuySolBalance: number = afterBuyBalances.SOL || 0;
    const afterBuyTokenBalance: number = afterBuyBalances[TOKEN_ADDRESS] || 0;
    
    console.log(`   SOL Balance: ${afterBuySolBalance}`);
    console.log(`   Token Balance: ${afterBuyTokenBalance}\n`);

    // Step 7: Get sell quote (sell 100% of tokens received)
    console.log('7. Getting sell quote...');
    const sellQuote = await getSwapQuote(
      TOKEN_ADDRESS,   // baseToken (selling token)
      'SOL',           // quoteToken (buying SOL)
      afterBuyTokenBalance, // amount (all tokens)
      'SELL',          // side (selling token to get SOL)
      POOL_ADDRESS
    );

    console.log(`   Expected to receive: ${sellQuote.estimatedAmountOut} SOL`);
    console.log(`   Price: ${sellQuote.price} SOL per token\n`);

    // Step 8: Execute sell
    console.log('8. Executing sell transaction...');
    const sellResult = await executeSwap(
      WALLET_ADDRESS,
      TOKEN_ADDRESS,   // baseToken
      'SOL',           // quoteToken
      afterBuyTokenBalance, // amount (all tokens)
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

    // Step 10: Check final balances
    console.log('10. Checking final balances...');
    const finalBalances = await checkBalances(WALLET_ADDRESS, ['SOL', TOKEN_ADDRESS]);
    
    const finalSolBalance: number = finalBalances.SOL || 0;
    const finalTokenBalance: number = finalBalances[TOKEN_ADDRESS] || 0;
    
    console.log(`   Final SOL Balance: ${finalSolBalance}`);
    console.log(`   Final Token Balance: ${finalTokenBalance}\n`);

    // Step 11: Calculate summary
    console.log('=== TRANSACTION SUMMARY ===');
    console.log(`Buy Transaction Hash: ${buyResult.signature}`);
    console.log(`Sell Transaction Hash: ${sellResult.signature}`);
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