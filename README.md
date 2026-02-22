# Token Cluster Visualizer

AVAX C-Chain token transfer analysis tool. Maps wallet interactions for any ERC-20 token and identifies wallet clusters belonging to the same entity.

## Features

- ERC-20 token transfer graph visualization (D3 force-directed)
- Live balance checking via Multicall3 (batch RPC)
- Auto-detection of contracts vs EOA wallets
- Wallet-to-Wallet mode (strips DEX/contract noise)
- Written cluster analysis report
- Token search/lookup by contract address
- **Deep Scan**: Hidden holdings detection — identifies wallets likely owned by the same person using 6 heuristics (bidirectional transfers, shared funding sources, timing correlation, sequential nonces, received-then-held, isolated wallets)

## Default Configuration

- Token: FLD (Fold) — 0x88f89be3e9b1dc1c5f208696fb9cabfcc684bd5f
- Target: 0xae13476C006Bf6409735FB1c7b253AA82a555Ff3
- Chain: Avalanche C-Chain (43114)

## Local Development

```bash
git clone https://github.com/SovrantyLLC/token-cluster.git
cd token-cluster
cp .env.example .env.local
npm install
npm run dev
```

## Deployment (Railway)

1. Fork or clone this repo
2. Connect to Railway: `railway link`
3. Set environment variables in Railway dashboard:
   - `AVAX_RPC_URL=https://api.avax.network/ext/bc/C/rpc`
   - `ROUTESCAN_API=https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api`
   - `SNOWSCAN_API=https://api.snowscan.xyz/api`
4. Deploy: `railway up` or push to main branch (auto-deploys)

Railway will auto-detect Next.js and build with Nixpacks.

## API Endpoints

| Route | Method | Rate Limit | Description |
|-------|--------|------------|-------------|
| `/api/scan` | POST | 30/min | Standard token transfer scan |
| `/api/deep-scan` | POST | 30/min | Deep scan with hidden holdings analysis |
| `/api/balance` | POST | 60/min | Batch token balance check |
| `/api/token-lookup` | POST | 60/min | ERC-20 token metadata lookup |
| `/api/detect-contracts` | POST | 60/min | Contract vs EOA detection |
| `/api/funding-source` | POST | 30/min | First AVAX funding source lookup |
| `/api/health` | GET | — | Service health check |
