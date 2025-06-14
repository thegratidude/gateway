const axios = require('axios');

const CONNECTOR = 'raydium';
const PROTOCOL = 'amm';
const NETWORK = 'mainnet-beta';
const TEST_WALLET = '82SggYRE2Vo4jN4a2pk3aQ4SET4ctafZJGbowmCqyHx5';
const POOL_ADDRESS = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'; // SOL-USDC pool
const BASE_TOKEN_MINT = 'So11111111111111111111111111111111111111112'; // SOL
const QUOTE_TOKEN_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC

describe('Raydium Direct Mint Address Swap Tests', () => {
  describe('Quote Swap Direct Endpoint', () => {
    test('returns and validates swap quote for SELL using mint addresses', async () => {
      // Make the request
      const response = await axios.get(
        `http://localhost:15888/connectors/${CONNECTOR}/${PROTOCOL}/quote-swap-direct`,
        {
          params: {
            network: NETWORK,
            poolAddress: POOL_ADDRESS,
            baseTokenMint: BASE_TOKEN_MINT,
            quoteTokenMint: QUOTE_TOKEN_MINT,
            amount: 0.01,
            side: 'SELL',
            slippagePct: 1.0,
          },
        },
      );

      // Validate the response
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('poolAddress');
      expect(response.data).toHaveProperty('estimatedAmountIn');
      expect(response.data).toHaveProperty('estimatedAmountOut');
      expect(response.data).toHaveProperty('minAmountOut');
      expect(response.data).toHaveProperty('maxAmountIn');
      expect(response.data).toHaveProperty('baseTokenBalanceChange');
      expect(response.data).toHaveProperty('quoteTokenBalanceChange');
      expect(response.data).toHaveProperty('price');

      // Check expected values for a SELL
      expect(response.data.baseTokenBalanceChange).toBeLessThan(0); // SELL means negative base token change
      expect(response.data.quoteTokenBalanceChange).toBeGreaterThan(0); // SELL means positive quote token change
      expect(response.data.estimatedAmountIn).toBe(0.01); // Should match input amount
      expect(response.data.price).toBeGreaterThan(0);
    });

    test('returns and validates swap quote for BUY using mint addresses', async () => {
      // Make the request
      const response = await axios.get(
        `http://localhost:15888/connectors/${CONNECTOR}/${PROTOCOL}/quote-swap-direct`,
        {
          params: {
            network: NETWORK,
            poolAddress: POOL_ADDRESS,
            baseTokenMint: BASE_TOKEN_MINT,
            quoteTokenMint: QUOTE_TOKEN_MINT,
            amount: 1.0, // USDC amount
            side: 'BUY',
            slippagePct: 1.0,
          },
        },
      );

      // Validate the response
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('poolAddress');
      expect(response.data).toHaveProperty('estimatedAmountIn');
      expect(response.data).toHaveProperty('estimatedAmountOut');
      expect(response.data).toHaveProperty('minAmountOut');
      expect(response.data).toHaveProperty('maxAmountIn');
      expect(response.data).toHaveProperty('baseTokenBalanceChange');
      expect(response.data).toHaveProperty('quoteTokenBalanceChange');
      expect(response.data).toHaveProperty('price');

      // Check expected values for a BUY
      expect(response.data.baseTokenBalanceChange).toBeGreaterThan(0); // BUY means positive base token change
      expect(response.data.quoteTokenBalanceChange).toBeLessThan(0); // BUY means negative quote token change
      expect(response.data.estimatedAmountOut).toBe(1.0); // Should match input amount for BUY
      expect(response.data.price).toBeGreaterThan(0);
    });

    test('validates mint addresses match pool tokens', async () => {
      // Test with invalid mint addresses
      try {
        await axios.get(
          `http://localhost:15888/connectors/${CONNECTOR}/${PROTOCOL}/quote-swap-direct`,
          {
            params: {
              network: NETWORK,
              poolAddress: POOL_ADDRESS,
              baseTokenMint: 'InvalidMintAddress123',
              quoteTokenMint: QUOTE_TOKEN_MINT,
              amount: 0.01,
              side: 'SELL',
              slippagePct: 1.0,
            },
          },
        );
        fail('Should have thrown an error for invalid mint address');
      } catch (error) {
        expect(error.response.status).toBe(400);
        expect(error.response.data.message).toContain('Invalid mint address');
      }
    });
  });

  describe('Execute Swap Direct Endpoint', () => {
    test('validates request parameters', async () => {
      // Test with missing required parameters
      try {
        await axios.post(
          `http://localhost:15888/connectors/${CONNECTOR}/${PROTOCOL}/execute-swap-direct`,
          {
            network: NETWORK,
            // Missing required parameters
          },
        );
        fail('Should have thrown an error for missing parameters');
      } catch (error) {
        expect(error.response.status).toBe(400);
      }
    });

    test('validates mint addresses and pool address format', async () => {
      try {
        await axios.post(
          `http://localhost:15888/connectors/${CONNECTOR}/${PROTOCOL}/execute-swap-direct`,
          {
            network: NETWORK,
            walletAddress: TEST_WALLET,
            poolAddress: 'InvalidPoolAddress',
            baseTokenMint: BASE_TOKEN_MINT,
            quoteTokenMint: QUOTE_TOKEN_MINT,
            amount: 0.01,
            side: 'SELL',
            slippagePct: 1.0,
          },
        );
        fail('Should have thrown an error for invalid pool address');
      } catch (error) {
        expect(error.response.status).toBe(400);
        expect(error.response.data.message).toContain(
          'Invalid mint address, pool address, or wallet address',
        );
      }
    });
  });
});
