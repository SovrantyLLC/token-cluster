// ══════════════════════════════════════════════════════════════════════════════
// Token-specific DeFi configuration registry
// ══════════════════════════════════════════════════════════════════════════════
// The generic scanner works for all ERC-20 tokens on AVAX. But tokens with
// known staking/vault/farm contracts can provide extra config for deeper
// analysis (staked LP detection, single-stake detection, etc).
//
// TODO (FUTURE): /admin page to add/edit token configs without code changes.
// Structure is designed so swapping to DB or API-loaded configs is trivial —
// just replace the in-memory TOKEN_CONFIGS with an async loader.
// ══════════════════════════════════════════════════════════════════════════════

export interface StakingContractConfig {
  address: string;
  label: string;
  type: 'masterchef' | 'single-stake' | 'gauge' | 'custom';
  balanceMethod: {
    selector: string;
    encoding: 'simple' | 'pid' | 'abi-functions';
    pid?: number;
    resultIndex?: number;
    decimals?: number;
    /** Function name for abi-functions encoding, e.g. 'getStake' */
    abiFunction?: string;
  };
  stakedAsset: 'token' | 'lp-token';
  lpPairAddress?: string;
  depositEventSignature?: string;
}

export interface TokenConfig {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chain: 'avax';
  stakingContracts: StakingContractConfig[];
  knownEcosystemContracts: Record<string, string>;
  knownLPPairs: Record<string, string>;
}

const TOKEN_CONFIGS: Record<string, TokenConfig> = {};

export function getTokenConfig(tokenAddress: string): TokenConfig | null {
  return TOKEN_CONFIGS[tokenAddress.toLowerCase()] || null;
}

// ═══════════════════════════════════════════════════
// FLD (FOLD) — Ninety1 / Lab91 Ecosystem
// ═══════════════════════════════════════════════════
// Staking contract ABI verified on Snowtrace:
//   getStake(address) — returns staking "power" as whole tokens (no decimals)
//   stakedTotal(address) — same value
//   pendingRewards(address) — claimable FLD rewards (no decimals)
//   LPStakes(address, address) — LP-specific stakes
//   deposit(uint256, address) / depositLP(uint256, address) — deposit methods
// Values are stored as whole FLD tokens (decimals: 0)
// ═══════════════════════════════════════════════════

TOKEN_CONFIGS['0x88f89be3e9b1dc1c5f208696fb9cabfcc684bd5f'] = {
  address: '0x88f89be3e9b1dc1c5f208696fb9cabfcc684bd5f',
  symbol: 'FLD',
  name: 'Fold',
  decimals: 18,
  chain: 'avax',
  stakingContracts: [
    {
      address: '0x17427aF0F2E0ed27856C3288Bb902115467e2540',
      label: 'Ninety1 Staking',
      type: 'custom',
      balanceMethod: {
        selector: '0xf5679189', // stakedTotal(address) or getStake(address)
        encoding: 'abi-functions',
        abiFunction: 'getStake',
        decimals: 0, // Ninety1 stores as whole tokens
      },
      stakedAsset: 'token', // Combined FLD + FATE staking power in FLD terms
    },
  ],
  knownEcosystemContracts: {
    '0x17427af0f2e0ed27856c3288bb902115467e2540': 'Ninety1 Staking',
    '0x86840ea36dd141719003aea81d3630917eb35d8d': 'Twenty6Fifty2',
    '0x8f1f74e9cad296f99a6f36a56e1f3afb45571cc9': 'Ninety1 NFT (ERC1155)',
    '0x6bb77d0f531a4b6f1c72676a814df5e4fb50f1d6': 'LeVeL Contract',
    '0x9748156a1784251c31eb5e2d0894be8060213737': 'PASS OTC',
    '0x32f0c28be6a6ac5d3b471278b77f6971a3141348': 'FATE v2 Token',
    '0x66cf3ffb034ea5bd30457662a470ad67bc96759b': 'FATE v1 Token',
    '0xebe2eae72d6eaa44a3bca32cfdf81d3a687917c2': 'EVB Token',
    '0x0256b279d973c8d687264ac3eb36be09232d4474': 'MYST Token',
    '0x800bdce6caa3fe2bfdb738383321278536e258f8': 'wTHT Token',
    '0xd31cfa160354752727f800e3a468a5d851327167': 'FATE(v1)/FLD Liquidity Mgr',
    '0xaa2e00e33d101542ddeeb27da8ebb13ae94c5632': 'FATE/FLD Liquidity Mgr',
  },
  knownLPPairs: {
    '0xf1840b4ae6dcc58e8dbe514510ffe7737b9acb47': 'FLD/AVAX (TraderJoe)',
    '0xf129618253bcff0f9a597e8103d2be065d17a310': 'EVB/FLD (TraderJoe)',
    '0x0dbcb787458fa66ba71b1b808008fee43edac252': 'FLD/AVAX (VaporDEX)',
    '0x437705f77b5536dade2b3425475b72a0af5f1fe7': 'FLD/USDC (VaporDEX)',
    '0xe8ef9cc2f20205c5a243efc957a47865e53bfcad': 'VAPE/FLD (VaporDEX)',
    '0x7c89dc798d832fe979da9bdf2b2eed593f7e5a5b': 'wTHT/FLD (VaporDEX)',
    '0x6904885d59d891cbc5653092ab011d5e324f5c5c': 'FLD/ARENA (VaporDEX)',
    '0x3770ee1844d6ec809ad66e060518b18ba07f9ca4': 'MYST/FLD (VaporDEX)',
    '0xcf55499e13bf758ddb9d40883c1e123ce18c2888': 'FATE/FLD (VaporDEX)',
    '0x9088b3ae8428e6666b8b82f8079cc74df27e7793': 'HIGHER/FLD (VaporDEX)',
    '0xa8655fd2afb1adcd37aa8b9b13818471637bb782': 'FATE(v1)/FLD (VaporDEX)',
  },
};
