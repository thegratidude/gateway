const axios = require('axios');

// Configuration
const GATEWAY_URL = 'http://localhost:15888';
const NETWORK = 'mainnet-beta';
const WALLET_ADDRESS = '4jW7MurVJiFZE9TocvDSyJYk49ZNK37oZwJEM2gn7Eyk';
const POOL_ADDRESS = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';
const SLIPPAGE_PCT = 1.0;
const SWAP_AMOUNT = 0.01; // 0.01 SOL

// Performance tracking
const performanceMetrics = {
  buy: {},
  sell: {},
  totalTime: 0
};

/**
 * Time a function execution and log the duration
 */
async function timeStep(stepName, asyncFunction, testType = 'buy') {
  const startTime = Date.now();
  console.log(`⏱️  [${testType.toUpperCase()}] Starting: ${stepName}`);
  
  try {
    const result = await asyncFunction();
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    performanceMetrics[testType][stepName] = {
      duration,
      success: true,
      timestamp: new Date().toISOString()
    };
    
    console.log(`✅ [${testType.toUpperCase()}] Completed: ${stepName} (${duration}ms)`);
    return result;
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    performanceMetrics[testType][stepName] = {
      duration,
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
    
    console.log(`❌ [${testType.toUpperCase()}] Failed: ${stepName} (${duration}ms) - ${error.message}`);
    throw error;
  }
}

/**
 * Check wallet balances
 */
async function checkBalances(walletAddress) {
  const response = await axios.post(`${GATEWAY_URL}/chains/solana/balances`, {
    network: NETWORK,
    address: walletAddress,
    tokens: ['SOL', 'USDC']
  });
  return response.data.balances;
}

/**
 * Execute optimized swap
 */
async function executeOptimizedSwap(walletAddress, baseToken, quoteToken, amount, side, poolAddress) {
  const response = await axios.post(`${GATEWAY_URL}/connectors/raydium/amm/execute-swap-optimized`, {
    network: NETWORK,
    walletAddress: walletAddress,
    baseToken: baseToken,
    quoteToken: quoteToken,
    amount: amount,
    side: side,
    slippagePct: SLIPPAGE_PCT,
    poolAddress: poolAddress
  });
  return response.data;
}

/**
 * Monitor transaction confirmation
 */
async function monitorTransaction(signature) {
  let attempts = 0;
  const maxAttempts = 30;
  
  while (attempts < maxAttempts) {
    try {
      const response = await axios.post(`${GATEWAY_URL}/chains/solana/poll`, {
        network: NETWORK,
        signature: signature
      });
      
      if (response.data.txStatus === 1) {
        return response.data;
      }
    } catch (error) {
      // Continue polling
    }
    
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error('Transaction confirmation timeout');
}

/**
 * Test BUY operation (standard flow)
 */
async function testBuyOperation() {
  console.log('\n🔄 TESTING BUY OPERATION (Standard Flow)');
  console.log('==========================================');
  
  const startTime = Date.now();
  
  try {
    // Step 1: Check initial balances
    const initialBalances = await timeStep('Check Initial Balances', () => 
      checkBalances(WALLET_ADDRESS), 'buy'
    );
    
    // Step 2: Execute BUY swap (SOL → USDC)
    const buyResult = await timeStep('Execute BUY Swap (SOL→USDC)', () =>
      executeOptimizedSwap(WALLET_ADDRESS, 'SOL', 'USDC', SWAP_AMOUNT, 'BUY', POOL_ADDRESS), 'buy'
    );

    // Step 3: Monitor transaction
    await timeStep('Monitor Transaction', () =>
      monitorTransaction(buyResult.signature), 'buy'
    );

    // Step 4: Check final balances
    const finalBalances = await timeStep('Check Final Balances', () =>
      checkBalances(WALLET_ADDRESS), 'buy'
    );

    const endTime = Date.now();
    performanceMetrics.buy.totalTime = endTime - startTime;

    console.log(`\n✅ BUY OPERATION COMPLETED in ${performanceMetrics.buy.totalTime}ms`);
    console.log(`Transaction: ${buyResult.signature}`);
    console.log(`SOL Change: ${(finalBalances.SOL - initialBalances.SOL).toFixed(6)}`);
    console.log(`USDC Change: ${(finalBalances.USDC - initialBalances.USDC).toFixed(6)}`);

    return {
      buyResult,
      initialBalances,
      finalBalances,
      usdcReceived: finalBalances.USDC - initialBalances.USDC
    };

  } catch (error) {
    const endTime = Date.now();
    performanceMetrics.buy.totalTime = endTime - startTime;
    console.error('❌ BUY operation failed:', error.message);
    throw error;
  }
}

/**
 * Test SELL operation (optimized flow)
 */
async function testSellOperation(usdcAmount) {
  console.log('\n⚡ TESTING SELL OPERATION (Ultra-Fast Optimized Flow)');
  console.log('=====================================================');
  
  const startTime = Date.now();
  
  try {
    // Step 1: Check initial balances
    const initialBalances = await timeStep('Check Initial Balances', () => 
      checkBalances(WALLET_ADDRESS), 'sell'
    );
    
    // Step 2: Get the actual USDC balance to sell (100% of balance)
    const actualUsdcBalance = initialBalances.USDC || 0;
    if (actualUsdcBalance <= 0) {
      throw new Error('No USDC balance to sell');
    }
    
    console.log(`   Selling 100% of USDC balance: ${actualUsdcBalance.toFixed(6)} USDC`);
    
    // Step 3: Execute SELL swap (USDC → SOL) with optimizations
    const sellResult = await timeStep('Execute SELL Swap (USDC→SOL)', () =>
      executeOptimizedSwap(WALLET_ADDRESS, 'USDC', 'SOL', actualUsdcBalance, 'SELL', POOL_ADDRESS), 'sell'
    );

    // Step 4: Monitor transaction
    await timeStep('Monitor Transaction', () =>
      monitorTransaction(sellResult.signature), 'sell'
    );

    // Step 5: Check final balances
    const finalBalances = await timeStep('Check Final Balances', () =>
      checkBalances(WALLET_ADDRESS), 'sell'
    );

    const endTime = Date.now();
    performanceMetrics.sell.totalTime = endTime - startTime;

    console.log(`\n✅ SELL OPERATION COMPLETED in ${performanceMetrics.sell.totalTime}ms`);
    console.log(`Transaction: ${sellResult.signature}`);
    console.log(`SOL Change: ${(finalBalances.SOL - initialBalances.SOL).toFixed(6)}`);
    console.log(`USDC Change: ${(finalBalances.USDC - initialBalances.USDC).toFixed(6)}`);

    return {
      sellResult,
      initialBalances,
      finalBalances
    };

  } catch (error) {
    const endTime = Date.now();
    performanceMetrics.sell.totalTime = endTime - startTime;
    console.error('❌ SELL operation failed:', error.message);
    throw error;
  }
}

/**
 * Print performance comparison
 */
function printPerformanceComparison() {
  console.log('\n📊 PERFORMANCE COMPARISON');
  console.log('=========================');
  
  const buyTotal = performanceMetrics.buy.totalTime || 0;
  const sellTotal = performanceMetrics.sell.totalTime || 0;
  
  console.log(`BUY Operation (Standard):  ${buyTotal}ms`);
  console.log(`SELL Operation (Optimized): ${sellTotal}ms`);
  
  if (buyTotal > 0 && sellTotal > 0) {
    const improvement = ((buyTotal - sellTotal) / buyTotal * 100).toFixed(1);
    const speedup = (buyTotal / sellTotal).toFixed(2);
    
    if (sellTotal < buyTotal) {
      console.log(`🚀 SELL is ${improvement}% faster than BUY`);
      console.log(`⚡ SELL is ${speedup}x faster than BUY`);
    } else {
      console.log(`⚠️  SELL is ${Math.abs(improvement)}% slower than BUY`);
    }
  }
  
  // Detailed step breakdown
  console.log('\n📋 DETAILED STEP BREAKDOWN');
  console.log('==========================');
  
  const buySteps = Object.keys(performanceMetrics.buy).filter(key => key !== 'totalTime');
  const sellSteps = Object.keys(performanceMetrics.sell).filter(key => key !== 'totalTime');
  
  console.log('\nBUY Steps:');
  buySteps.forEach(step => {
    const duration = performanceMetrics.buy[step]?.duration || 0;
    console.log(`  - ${step}: ${duration}ms`);
  });
  
  console.log('\nSELL Steps:');
  sellSteps.forEach(step => {
    const duration = performanceMetrics.sell[step]?.duration || 0;
    console.log(`  - ${step}: ${duration}ms`);
  });
  
  return {
    buyTotal,
    sellTotal,
    improvement: buyTotal > 0 && sellTotal > 0 ? ((buyTotal - sellTotal) / buyTotal * 100).toFixed(1) : 0
  };
}

/**
 * Main test runner
 */
async function runUltraFastSellOptimizationTest() {
  console.log('🚀 ULTRA-FAST SELL OPTIMIZATION TEST');
  console.log('=====================================');
  console.log(`Wallet: ${WALLET_ADDRESS}`);
  console.log(`Pool: ${POOL_ADDRESS}`);
  console.log(`Amount: ${SWAP_AMOUNT} SOL`);
  console.log(`Network: ${NETWORK}`);
  console.log(`Slippage: ${SLIPPAGE_PCT}%`);
  
  const overallStartTime = Date.now();
  
  try {
    // Test BUY operation first
    const buyResult = await testBuyOperation();
    
    // Wait between tests
    console.log('\n⏳ Waiting 3 seconds between tests...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Test SELL operation with optimizations
    const sellResult = await testSellOperation(buyResult.usdcReceived);
    
    // Print comparison
    const comparison = printPerformanceComparison();
    
    const overallEndTime = Date.now();
    performanceMetrics.totalTime = overallEndTime - overallStartTime;
    
    console.log(`\n🎯 OPTIMIZATION TEST COMPLETED`);
    console.log(`Total test time: ${performanceMetrics.totalTime}ms`);
    console.log(`BUY time: ${comparison.buyTotal}ms`);
    console.log(`SELL time: ${comparison.sellTotal}ms`);
    console.log(`Performance improvement: ${comparison.improvement}%`);
    
    return {
      buy: buyResult,
      sell: sellResult,
      comparison,
      performanceMetrics
    };
    
  } catch (error) {
    const overallEndTime = Date.now();
    performanceMetrics.totalTime = overallEndTime - overallStartTime;
    
    console.error('\n❌ Ultra-fast SELL optimization test failed:', error.message);
    printPerformanceComparison();
    throw error;
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  runUltraFastSellOptimizationTest()
    .then(result => {
      console.log('\n🎉 Test completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Test failed:', error.message);
      process.exit(1);
    });
}

module.exports = {
  runUltraFastSellOptimizationTest,
  testBuyOperation,
  testSellOperation,
  printPerformanceComparison
}; 