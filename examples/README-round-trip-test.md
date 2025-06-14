# Round Trip Swap Test Setup (TypeScript)

## Environment Variables Setup

1. **Create your `.env` file:**
   ```bash
   cd gateway
   cp env-template.txt .env
   ```

2. **Edit the `.env` file** with your actual values:

   ```env
   # Gateway Configuration
   GATEWAY_URL=http://localhost:15888
   NETWORK=mainnet-beta

   # Helius RPC Configuration
   HELIUS_RPC_URL=https://your-helius-rpc-url-here.helius-rpc.com/?api-key=your-api-key
   HELIUS_WEBSOCKET_URL=wss://your-helius-websocket-url-here.helius-rpc.com/?api-key=your-api-key

   # Solana Wallet Configuration
   WALLET_ADDRESS=your-solana-wallet-address-here
   WALLET_PRIVATE_KEY=your-wallet-private-key-here

   # Test Configuration
   BUY_AMOUNT_SOL=0.001
   SLIPPAGE_PCT=1.0
   WAIT_TIME_MS=10000

   # Pool and Token Configuration
   POOL_ADDRESS=your-pool-address-here
   TOKEN_ADDRESS=your-token-address-here
   ```

## Required Values

- **WALLET_ADDRESS**: Your funded Solana wallet address
- **POOL_ADDRESS**: Raydium pool address for the token pair
- **TOKEN_ADDRESS**: Base token mint address
- **HELIUS_RPC_URL**: Your Helius RPC endpoint
- **HELIUS_WEBSOCKET_URL**: Your Helius WebSocket endpoint

## Running the TypeScript Test

### Option 1: Using ts-node (Recommended)
```bash
cd gateway
npx ts-node examples/round-trip-swap-test.ts
```

### Option 2: Build and Run
```bash
cd gateway
npm run build
node dist/examples/round-trip-swap-test.js
```

## What the Test Does

The script will:
1. Buy 0.001 SOL worth of tokens
2. Return transaction hash
3. Wait 10 seconds
4. Sell 100% of tokens received
5. Return transaction hash and summary

## TypeScript Features

- Full type safety with interfaces for all API responses
- Proper error handling with type checking
- Exported types for use in other TypeScript modules
- Environment variable validation 