const axios = require('axios');

// Configuration
const GATEWAY_URL = 'http://localhost:15888';
const NETWORK = 'mainnet-beta';
const WALLET_ADDRESS = 'FzsbG1gw9n74FVJbP1VktV4e9wJ9DYmkAVXGJegLqPqr';
const POOL_ADDRESS = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';

/**
 * Check wallet balances
 */
async function checkBalances(walletAddress, tokens = ['SOL', 'USDC']) {
  try {
    const response = await axios.post(`${GATEWAY_URL}/chains/solana/balances`, {
      network: NETWORK,
      address: walletAddress,
      tokens: tokens
    });
    return response.data.balances;
  } catch (error) {
    console.error('Error checking balances:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Execute optimized swap
 */
async function executeOptimizedSwap(walletAddress, baseToken, quoteToken, amount, side, poolAddress) {
  try {
    const response = await axios.post(`${GATEWAY_URL}/connectors/raydium/amm/execute-swap-optimized`, {
      network: NETWORK,
      walletAddress: walletAddress,
      baseToken: baseToken,
      quoteToken: quoteToken,
      amount: amount,
      side: side,
      slippagePct: 1.0,
      poolAddress: poolAddress
    });
    return response.data;
  } catch (error) {
    console.error('Error executing swap:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Demonstrate the correct API pattern for round-trip swaps
 */
async function demonstrateRoundTripPattern() {
  console.log('🔄 DEMONSTRATING ROUND-TRIP SWAP PATTERN');
  console.log('=========================================');
  console.log(`Wallet: ${WALLET_ADDRESS}`);
  console.log(`Pool: ${POOL_ADDRESS}`);
  console.log(`Network: ${NETWORK}`);
  
  try {
    // Step 1: Check initial balances
    console.log('\n1. Checking initial balances...');
    const initialBalances = await checkBalances(WALLET_ADDRESS);
    console.log('Initial balances:', initialBalances);
    
    // Step 2: Demonstrate BUY pattern (will fail due to insufficient funds)
    console.log('\n2. Demonstrating BUY pattern...');
    console.log('   This will fail due to insufficient SOL balance, but shows the correct API call:');
    
    try {
      const buyResult = await executeOptimizedSwap(
        WALLET_ADDRESS,
        'SOL',
        'USDC',
        0.005, // Smaller amount to fit within balance
        'BUY',
        POOL_ADDRESS
      );
      console.log('   ✅ BUY successful:', buyResult);
      
      // Step 3: Demonstrate SELL pattern using buy result
      console.log('\n3. Demonstrating SELL pattern using buy result...');
      console.log(`   Using exact amount from buy: ${buyResult.totalOutputSwapped} USDC`);
      
      const sellResult = await executeOptimizedSwap(
        WALLET_ADDRESS,
        'USDC',
        'SOL',
        buyResult.totalOutputSwapped, // Exact amount received from buy
        'SELL',
        POOL_ADDRESS
      );
      console.log('   ✅ SELL successful:', sellResult);
      
      // Step 4: Show final balances
      console.log('\n4. Checking final balances...');
      const finalBalances = await checkBalances(WALLET_ADDRESS);
      console.log('Final balances:', finalBalances);
      
    } catch (swapError) {
      console.log('   ❌ Expected failure due to insufficient funds');
      console.log('   Error:', swapError.response?.data?.error || swapError.message);
    }
    
    // Step 5: Show the correct code pattern
    console.log('\n📋 CORRECT CODE PATTERN FOR YOUR IMPLEMENTATION:');
    console.log('==================================================');
    console.log(`
// Your code should follow this pattern:

// 1. BUY tokens
const buyResult = await executeSwap({
  walletAddress: '${WALLET_ADDRESS}',
  baseToken: 'SOL',
  quoteToken: 'USDC',
  amount: 0.01, // Amount of SOL to spend
  side: 'BUY',
  slippagePct: 1.0,
  poolAddress: '${POOL_ADDRESS}'
});

console.log(\`Bought \${buyResult.totalOutputSwapped} USDC for \${buyResult.totalInputSwapped} SOL\`);

// 2. SELL all tokens received (exact amount from buy)
const sellResult = await executeSwap({
  walletAddress: '${WALLET_ADDRESS}',
  baseToken: 'USDC',
  quoteToken: 'SOL',
  amount: buyResult.totalOutputSwapped, // Exact amount received from buy
  side: 'SELL',
  slippagePct: 1.0,
  poolAddress: '${POOL_ADDRESS}'
});

console.log(\`Sold \${sellResult.totalInputSwapped} USDC for \${sellResult.totalOutputSwapped} SOL\`);
    `);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the demonstration
demonstrateRoundTripPattern().catch(console.error); 