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
  // Ninety1 / Lab91 Core Contracts
  '0x17427af0f2e0ed27856c3288bb902115467e2540': 'Ninety1 Staking',
  '0x86840ea36dd141719003aea81d3630917eb35d8d': 'Twenty6Fifty2',
  '0x8f1f74e9cad296f99a6f36a56e1f3afb45571cc9': 'Ninety1 NFT',
  '0x6bb77d0f531a4b6f1c72676a814df5e4fb50f1d6': 'LeVeL Contract',
  '0x9748156a1784251c31eb5e2d0894be8060213737': 'PASS OTC',
  // Lab91 Tokens
  '0x32f0c28be6a6ac5d3b471278b77f6971a3141348': 'FATE v2 Token',
  '0x66cf3ffb034ea5bd30457662a470ad67bc96759b': 'FATE v1 Token',
  '0xebe2eae72d6eaa44a3bca32cfdf81d3a687917c2': 'EVB Token',
  '0x0256b279d973c8d687264ac3eb36be09232d4474': 'MYST Token',
  '0x800bdce6caa3fe2bfdb738383321278536e258f8': 'wTHT Token',
  // Lab91 Treasury / Team Wallets
  '0x8e453683b58c4f62da7066e00dbe709d2b33f76f': 'LabNinety1 Team',
  '0xf8125adc6b0405c274d0236e609fea120074926f': 'Havoc Billiards',
  '0xfdb3d70d513d9fdbca4518455955409b11224f99': 'Havoc Arena Treasury',
  '0x5c974f501e599889c29503aeaea01a13ed231fbd': 'Fate Gatekeeper Treasury',
  '0x6d4a024f322d30afe305a3111c1053e3040da6ea': 'Fate Warchest',
  // Lab91 Liquidity Managers
  '0xd31cfa160354752727f800e3a468a5d851327167': 'FATE(v1)/FLD Liquidity Mgr',
  '0xaa2e00e33d101542ddeeb27da8ebb13ae94c5632': 'FATE/FLD Liquidity Mgr',
  // FLD LP Pairs — Qualified
  '0xf1840b4ae6dcc58e8dbe514510ffe7737b9acb47': 'FLD/AVAX LP (TraderJoe)',
  '0xf129618253bcff0f9a597e8103d2be065d17a310': 'EVB/FLD LP (TraderJoe)',
  '0x0dbcb787458fa66ba71b1b808008fee43edac252': 'FLD/AVAX LP (VaporDEX)',
  '0x437705f77b5536dade2b3425475b72a0af5f1fe7': 'FLD/USDC LP (VaporDEX)',
  '0xe8ef9cc2f20205c5a243efc957a47865e53bfcad': 'VAPE/FLD LP (VaporDEX)',
  '0x7c89dc798d832fe979da9bdf2b2eed593f7e5a5b': 'wTHT/FLD LP (VaporDEX)',
  '0x6904885d59d891cbc5653092ab011d5e324f5c5c': 'FLD/ARENA LP (VaporDEX)',
  '0x3770ee1844d6ec809ad66e060518b18ba07f9ca4': 'MYST/FLD LP (VaporDEX)',
  '0xcf55499e13bf758ddb9d40883c1e123ce18c2888': 'FATE/FLD LP (VaporDEX)',
  // FLD LP Pairs — Non-Qualified
  '0x9088b3ae8428e6666b8b82f8079cc74df27e7793': 'HIGHER/FLD LP (VaporDEX)',
  '0xa8655fd2afb1adcd37aa8b9b13818471637bb782': 'FATE(v1)/FLD LP (VaporDEX)',
};

export const TOKEN_PRESETS: TokenInfo[] = [
  { symbol: 'FLD', name: 'Fold', address: '0x88f89be3e9b1dc1c5f208696fb9cabfcc684bd5f', decimals: 18 },
  { symbol: 'WAVAX', name: 'Wrapped AVAX', address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', decimals: 18 },
  { symbol: 'USDC', name: 'USD Coin', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
  { symbol: 'JOE', name: 'TraderJoe', address: '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd', decimals: 18 },
];

export const DEFAULT_TARGET = '0xae13476C006Bf6409735FB1c7b253AA82a555Ff3';
