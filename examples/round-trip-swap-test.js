require('dotenv').config();
const axios = require('axios');

// Configuration from environment variables
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:15888';
const NETWORK = process.env.NETWORK || 'mainnet-beta';
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const POOL_ADDRESS = process.env.POOL_ADDRESS;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;

// Constants for the test
const BUY_AMOUNT_SOL = parseFloat(process.env.BUY_AMOUNT_SOL) || 0.001;
const SLIPPAGE_PCT = parseFloat(process.env.SLIPPAGE_PCT) || 1.0;
const WAIT_TIME_MS = parseInt(process.env.WAIT_TIME_MS) || 10000;

// Timing helper function
function timeOperation(operationName, operation) {
  return async (...args) => {
    const startTime = Date.now();
    try {
      const result = await operation(...args);
      const endTime = Date.now();
      const duration = endTime - startTime;
      console.log(`⏱️  ${operationName}: ${duration}ms`);
      return result;
    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      console.log(`⏱️  ${operationName}: ${duration}ms (FAILED)`);
      throw error;
    }
  };
}

/**
 * Check wallet balances
 */
async function checkBalances(walletAddress, tokens = ['SOL']) {
  try {
    const response = await axios.post(`${GATEWAY_URL}/chains/solana/balances`, {
      network: NETWORK,
      address: walletAddress,
      tokens: tokens
    });

    console.log('Balance Response:', response.data);
    return response.data.balances;
  } catch (error) {
    console.error('Error checking balances:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get swap quote
 */
async function getSwapQuote(baseToken, quoteToken, amount, side, poolAddress) {
  try {
    const response = await axios.get(`${GATEWAY_URL}/connectors/raydium/amm/quote-swap`, {
      params: {
        network: NETWORK,
        baseToken: baseToken,
        quoteToken: quoteToken,
        amount: amount,
        side: side,
        slippagePct: SLIPPAGE_PCT,
        poolAddress: poolAddress
      }
    });

    console.log('Quote Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error getting quote:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Execute swap
 */
async function executeSwap(walletAddress, baseToken, quoteToken, amount, side, poolAddress) {
  try {
    const response = await axios.post(`${GATEWAY_URL}/connectors/raydium/amm/execute-swap`, {
      network: NETWORK,
      walletAddress: walletAddress,
      baseToken: baseToken,
      quoteToken: quoteToken,
      amount: amount,
      side: side,
      slippagePct: SLIPPAGE_PCT,
      poolAddress: poolAddress
    });

    console.log('Swap Execution Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error executing swap:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Monitor transaction status
 */
async function monitorTransaction(signature) {
  try {
    const response = await axios.post(`${GATEWAY_URL}/chains/solana/poll`, {
      network: NETWORK,
      signature: signature
    });

    console.log('Transaction Status:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error monitoring transaction:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Wait for specified milliseconds
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute round trip swap test
 */
async function executeRoundTripSwap() {
  console.log('=== Raydium AMM Round Trip Swap Test ===\n');

  // Validate required parameters
  if (WALLET_ADDRESS === 'YOUR_WALLET_ADDRESS_HERE') {
    throw new Error('Please set WALLET_ADDRESS to your actual Solana wallet address');
  }
  if (POOL_ADDRESS === 'POOL_ADDRESS_HERE') {
    throw new Error('Please set POOL_ADDRESS to the actual Raydium pool address');
  }
  if (TOKEN_ADDRESS === 'TOKEN_ADDRESS_HERE') {
    throw new Error('Please set TOKEN_ADDRESS to the actual token mint address');
  }

  console.log('Configuration:');
  console.log(`  Wallet Address: ${WALLET_ADDRESS}`);
  console.log(`  Pool Address: ${POOL_ADDRESS}`);
  console.log(`  Token Address: ${TOKEN_ADDRESS}`);
  console.log(`  Buy Amount: ${BUY_AMOUNT_SOL} SOL`);
  console.log(`  Slippage: ${SLIPPAGE_PCT}%`);
  console.log(`  Wait Time: ${WAIT_TIME_MS / 1000} seconds\n`);

  // Create timed versions of functions
  const timedCheckBalances = timeOperation('Balance Check', checkBalances);
  const timedGetSwapQuote = timeOperation('Get Quote', getSwapQuote);
  const timedExecuteSwap = timeOperation('Execute Swap', executeSwap);
  const timedMonitorTransaction = timeOperation('Monitor Transaction', monitorTransaction);

  try {
    // Step 1: Check initial balances
    console.log('1. Checking initial balances...');
    const initialBalances = await timedCheckBalances(WALLET_ADDRESS, ['SOL', TOKEN_ADDRESS]);
    
    const initialSolBalance = initialBalances.SOL || 0;
    // Try to get token balance by address first, then by symbol
    const initialTokenBalance = initialBalances[TOKEN_ADDRESS] || initialBalances.RAY || 0;
    
    console.log(`   Initial SOL Balance: ${initialSolBalance}`);
    console.log(`   Initial Token Balance: ${initialTokenBalance}\n`);

    // Check if we have enough SOL for the buy
    if (initialSolBalance < BUY_AMOUNT_SOL + 0.01) { // Extra 0.01 for fees
      throw new Error(`Insufficient SOL balance. Need at least ${BUY_AMOUNT_SOL + 0.01} SOL, have ${initialSolBalance}`);
    }

    // Step 2: Get buy quote
    console.log('2. Getting buy quote...');
    const buyQuote = await timedGetSwapQuote(
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
    const buyResult = await timedExecuteSwap(
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
    const buyTxStatus = await timedMonitorTransaction(buyResult.signature);
    console.log(`   Buy Transaction Status: ${JSON.stringify(buyTxStatus)}\n`);

    // Step 5: Wait 10 seconds
    console.log(`5. Waiting ${WAIT_TIME_MS / 1000} seconds...`);
    const waitStartTime = Date.now();
    await wait(WAIT_TIME_MS);
    const waitEndTime = Date.now();
    console.log(`   Wait complete (${waitEndTime - waitStartTime}ms)\n`);

    // Step 6: Check balances after buy
    console.log('6. Checking balances after buy...');
    const afterBuyBalances = await timedCheckBalances(WALLET_ADDRESS, ['SOL', TOKEN_ADDRESS]);
    
    const afterBuySolBalance = afterBuyBalances.SOL || 0;
    // Try to get token balance by address first, then by symbol
    const afterBuyTokenBalance = afterBuyBalances[TOKEN_ADDRESS] || afterBuyBalances.RAY || 0;
    
    console.log(`   SOL Balance: ${afterBuySolBalance}`);
    console.log(`   Token Balance: ${afterBuyTokenBalance}\n`);

    // Step 7: Get sell quote (sell 100% of tokens received)
    // CRITICAL OPTIMIZATION: Skip quote step for SELL orders to enable ultra-fast exits
    // This eliminates one round-trip and enables pre-packaging of instructions
    console.log('7. Getting sell quote...');
    console.log('   ⚡ ULTRA-FAST EXIT: Skipping external quote for SELL order');
    console.log('   ⚡ Quote will be calculated internally during transaction building');
    console.log('   ⚡ This eliminates one round-trip for fastest possible exit');
    
    // For SELL orders, we skip the external quote entirely
    // The quote calculation happens internally during transaction building
    // This is the core optimization that provides ultra-fast exits
    const sellQuote = {
      poolAddress: POOL_ADDRESS,
      estimatedAmountIn: afterBuyTokenBalance,
      estimatedAmountOut: 0, // Will be calculated internally
      minAmountOut: 0,
      maxAmountIn: afterBuyTokenBalance,
      baseTokenBalanceChange: -afterBuyTokenBalance,
      quoteTokenBalanceChange: 0,
      price: 0, // Will be calculated internally
      gasPrice: 0.5,
      gasLimit: 200000,
      gasCost: 0.000105
    };

    console.log(`   Expected to receive: ${sellQuote.estimatedAmountOut} SOL (calculated internally)`);
    console.log(`   Price: ${sellQuote.price} SOL per token (calculated internally)\n`);

    // Step 8: Execute sell
    console.log('8. Executing sell transaction...');
    const sellResult = await timedExecuteSwap(
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
    const sellTxStatus = await timedMonitorTransaction(sellResult.signature);
    console.log(`   Sell Transaction Status: ${JSON.stringify(sellTxStatus)}\n`);

    // Step 10: Check final balances
    console.log('10. Checking final balances...');
    const finalBalances = await timedCheckBalances(WALLET_ADDRESS, ['SOL', TOKEN_ADDRESS]);
    
    const finalSolBalance = finalBalances.SOL || 0;
    // Try to get token balance by address first, then by symbol
    const finalTokenBalance = finalBalances[TOKEN_ADDRESS] || finalBalances.RAY || 0;
    
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
    console.error('Round trip swap test failed:', error.message);
    throw error;
  }
}

/**
 * Main function to run the test
 */
async function main() {
  try {
    const result = await executeRoundTripSwap();
    console.log('\nTest completed successfully!');
    return result;
  } catch (error) {
    console.error('\nTest failed:', error.message);
    process.exit(1);
  }
}

// Export functions for use in other scripts
module.exports = {
  executeRoundTripSwap,
  checkBalances,
  getSwapQuote,
  executeSwap,
  monitorTransaction
};

// Run if this file is executed directly
if (require.main === module) {
  main();
} 