import { TokenInfo } from './types';

export const AVAX_RPC = process.env.AVAX_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
export const ROUTESCAN_API = process.env.ROUTESCAN_API || 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api';
export const SNOWSCAN_API = process.env.SNOWSCAN_API || 'https://api.snowscan.xyz/api';

export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

export const KNOWN_CONTRACTS: Record<string, string> = {
  // DEX Routers
  '0x60ae616a2155ee3d9a68541ba4544862310933d4': 'TraderJoe Router v2',
  '0xb4315e873dbcf96ffd0acd8ea43f689d8c20fb30': 'TraderJoe Router v2.1',
  '0x18556ec73e7a7a2b4292c6b2148b570364631f28': 'TraderJoe Router v2.2',
  '0xe54ca86531e17ef3616d22ca28b0d458b6c89106': 'Pangolin Router',
  '0xdef171fe48cf0115b1d80b88dc8eab59176fee57': 'ParaSwap',
  '0x1111111254eeb25477b68fb85ed929f73a960582': '1inch Router',
  '0x6131b5fae19ea4f9d964eac0408e4408b66337b5': 'KyberSwap',
  '0x0000000000000000000000000000000000000000': 'Null Address',
  // Ninety1 / Lab91 Ecosystem
  '0x17427af0f2e0ed27856c3288bb902115467e2540': 'Ninety1 Staking',
  '0x8f1f74e9cad296f99a6f36a56e1f3afb45571cc9': 'Ninety1 NFT',
  '0xcf55499e13bf758ddb9d40883c1e123ce18c2888': 'VaporDEX VLP',
  // FLD LP Pairs
  '0xf1840b4ae6dcc58e8dbe514510ffe7737b9acb47': 'FLD/WAVAX LP (TraderJoe)',
  '0x0dbcb787458fa66ba71b1b808008fee43edac252': 'FLD/WAVAX LP (VaporDEX)',
  '0x437705f77b5536dade2b3425475b72a0af5f1fe7': 'FLD/USDC LP',
  '0x3770ee1844d6ec809ad66e060518b18ba07f9ca4': 'MYST/FLD LP',
};

export const TOKEN_PRESETS: TokenInfo[] = [
  { symbol: 'FLD', name: 'Fold', address: '0x88f89be3e9b1dc1c5f208696fb9cabfcc684bd5f', decimals: 18 },
  { symbol: 'WAVAX', name: 'Wrapped AVAX', address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', decimals: 18 },
  { symbol: 'USDC', name: 'USD Coin', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
  { symbol: 'JOE', name: 'TraderJoe', address: '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd', decimals: 18 },
];

export const DEFAULT_TARGET = '0xae13476C006Bf6409735FB1c7b253AA82a555Ff3';
