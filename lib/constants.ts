import { TokenInfo } from './types';

export const AVAX_RPC = process.env.AVAX_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
export const ROUTESCAN_API = process.env.ROUTESCAN_API || 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api';
export const SNOWSCAN_API = process.env.SNOWSCAN_API || 'https://api.snowscan.xyz/api';

export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

export const KNOWN_CONTRACTS: Record<string, string> = {
  '0x60ae616a2155ee3d9a68541ba4544862310933d4': 'TraderJoe Router v2',
  '0xb4315e873dbcf96ffd0acd8ea43f689d8c20fb30': 'TraderJoe Router v2.1',
  '0x18556ec73e7a7a2b4292c6b2148b570364631f28': 'TraderJoe Router v2.2',
  '0xe54ca86531e17ef3616d22ca28b0d458b6c89106': 'Pangolin Router',
  '0xdef171fe48cf0115b1d80b88dc8eab59176fee57': 'ParaSwap',
  '0x1111111254eeb25477b68fb85ed929f73a960582': '1inch Router',
  '0x6131b5fae19ea4f9d964eac0408e4408b66337b5': 'KyberSwap',
  '0x0000000000000000000000000000000000000000': 'Null Address',
};

export const TOKEN_PRESETS: TokenInfo[] = [
  { symbol: 'FLD', name: 'Fold', address: '0x88f89be3e9b1dc1c5f208696fb9cabfcc684bd5f', decimals: 18 },
  { symbol: 'WAVAX', name: 'Wrapped AVAX', address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', decimals: 18 },
  { symbol: 'USDC', name: 'USD Coin', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
  { symbol: 'JOE', name: 'TraderJoe', address: '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd', decimals: 18 },
];

export const DEFAULT_TARGET = '0xae13476C006Bf6409735FB1c7b253AA82a555Ff3';
