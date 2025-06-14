const axios = require('axios');

// Configuration
const GATEWAY_URL = 'http://localhost:15888';
const NETWORK = 'mainnet-beta';
const WALLET_ADDRESS = 'your_wallet_address_here';

// Example pool and token mints
const POOL_ADDRESS = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'; // SOL-USDC pool
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * Get a swap quote using direct mint addresses
 */
async function getQuoteDirect(baseTokenMint, quoteTokenMint, amount, side, poolAddress, slippagePct = 1.0) {
  try {
    const response = await axios.get(`${GATEWAY_URL}/connectors/raydium/amm/quote-swap-direct`, {
      params: {
        network: NETWORK,
        poolAddress,
        baseTokenMint,
        quoteTokenMint,
        amount,
        side,
        slippagePct,
      },
    });

    console.log('Quote Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error getting quote:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Execute a swap using direct mint addresses
 */
async function executeSwapDirect(walletAddress, baseTokenMint, quoteTokenMint, amount, side, poolAddress, slippagePct = 1.0) {
  try {
    const response = await axios.post(`${GATEWAY_URL}/connectors/raydium/amm/execute-swap-direct`, {
      network: NETWORK,
      walletAddress,
      poolAddress,
      baseTokenMint,
      quoteTokenMint,
      amount,
      side,
      slippagePct,
    });

    console.log('Swap Execution Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error executing swap:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Example arbitrage workflow using direct mint addresses
 */
async function arbitrageExample() {
  console.log('=== Raydium Direct Mint Address Arbitrage Example ===\n');

  // Step 1: Get quote for selling SOL for USDC
  console.log('1. Getting quote for SELL 0.01 SOL for USDC...');
  const sellQuote = await getQuoteDirect(
    SOL_MINT,
    USDC_MINT,
    0.01,
    'SELL',
    POOL_ADDRESS,
    1.0
  );

  console.log(`   Quote: ${sellQuote.estimatedAmountIn} SOL -> ${sellQuote.estimatedAmountOut} USDC`);
  console.log(`   Price: $${sellQuote.price}\n`);

  // Step 2: Get quote for buying SOL with USDC (reverse direction)
  console.log('2. Getting quote for BUY SOL with USDC...');
  const buyQuote = await getQuoteDirect(
    SOL_MINT,
    USDC_MINT,
    sellQuote.estimatedAmountOut, // Use the USDC amount from sell quote
    'BUY',
    POOL_ADDRESS,
    1.0
  );

  console.log(`   Quote: ${buyQuote.estimatedAmountIn} USDC -> ${buyQuote.estimatedAmountOut} SOL`);
  console.log(`   Price: $${buyQuote.price}\n`);

  // Step 3: Calculate potential profit
  const solReceived = buyQuote.estimatedAmountOut;
  const solSpent = sellQuote.estimatedAmountIn;
  const profit = solReceived - solSpent;
  const profitPercentage = (profit / solSpent) * 100;

  console.log('3. Arbitrage Analysis:');
  console.log(`   SOL Spent: ${solSpent}`);
  console.log(`   SOL Received: ${solReceived}`);
  console.log(`   Profit: ${profit} SOL (${profitPercentage.toFixed(4)}%)`);

  // Step 4: Execute trades if profitable (uncomment to actually execute)
  if (profit > 0 && profitPercentage > 0.5) { // Only if profit > 0.5%
    console.log('\n4. Executing arbitrage trades...');
    
    // Note: Uncomment these lines to actually execute trades
    // Make sure to set a valid wallet address above
    
    /*
    console.log('   Executing SELL trade...');
    const sellResult = await executeSwapDirect(
      WALLET_ADDRESS,
      SOL_MINT,
      USDC_MINT,
      0.01,
      'SELL',
      POOL_ADDRESS,
      1.0
    );
    console.log(`   SELL completed: ${sellResult.signature}`);

    console.log('   Executing BUY trade...');
    const buyResult = await executeSwapDirect(
      WALLET_ADDRESS,
      SOL_MINT,
      USDC_MINT,
      sellQuote.estimatedAmountOut,
      'BUY',
      POOL_ADDRESS,
      1.0
    );
    console.log(`   BUY completed: ${buyResult.signature}`);
    */
    
    console.log('   (Trades not executed - uncomment code to enable)');
  } else {
    console.log('\n4. No profitable arbitrage opportunity found.');
  }
}

/**
 * Example of working with new tokens not in the standard registry
 */
async function newTokenExample() {
  console.log('\n=== New Token Example ===\n');

  // Example: Working with a new token that might not be in the standard registry
  const newTokenMint = 'NewTokenMintAddressHere123456789';
  const poolAddress = 'NewTokenPoolAddressHere123456789';

  console.log('Getting quote for new token...');
  try {
    const quote = await getQuoteDirect(
      newTokenMint,
      USDC_MINT,
      100, // amount of new token
      'SELL',
      poolAddress,
      1.0
    );
    console.log('Quote for new token:', quote);
  } catch (error) {
    console.log('Error with new token (expected if addresses are invalid):', error.message);
  }
}

// Run the examples
async function main() {
  try {
    await arbitrageExample();
    await newTokenExample();
  } catch (error) {
    console.error('Example failed:', error.message);
  }
}

// Export functions for use in other scripts
module.exports = {
  getQuoteDirect,
  executeSwapDirect,
  arbitrageExample,
};

// Run if this file is executed directly
if (require.main === module) {
  main();
} 