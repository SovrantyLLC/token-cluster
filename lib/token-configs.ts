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
    encoding: 'simple' | 'pid' | 'auto-detect';
    pid?: number;
    resultIndex?: number;
    decimals?: number;
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
// Staking flow: FLD → LP (VaporDEX) → VLP token → staked in Ninety1 contract
// Deposit method: depositLP(uint256 _amount, address _lpAddress)
// Deposit event: Deposit(address user, uint256 amount, address recipient)
//   topic0: 0xe31c7b8d08ee7db0afa68782e1028ef92305caeea8626633ad44d413e30f6b2f
// Read method: auto-detected at runtime by probing the staking contract
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
        // Read method is auto-detected at runtime by probing the contract.
        // The deposit function is depositLP(uint256, address).
        // The probe tries: balanceOf, userInfo, getUserInfo, deposited, stakedBalance
        selector: 'auto-detect',
        encoding: 'auto-detect',
      },
      stakedAsset: 'lp-token',
      lpPairAddress: '0xcf55499E13bF758Ddb9D40883c1e123cE18c2888', // VaporDEX VLP (FLD/FATE)
      depositEventSignature: '0xe31c7b8d08ee7db0afa68782e1028ef92305caeea8626633ad44d413e30f6b2f',
    },
  ],
  knownEcosystemContracts: {
    '0x17427af0f2e0ed27856c3288bb902115467e2540': 'Ninety1 Staking',
    '0x8f1f74e9cad296f99a6f36a56e1f3afb45571cc9': 'Ninety1 NFT (ERC1155)',
    '0x32f0c28be6a6ac5d3b471278b77f6971a3141348': 'FATE Token',
    '0xebe2eae72d6eaa44a3bca32cfdf81d3a687917c2': 'EVB Token',
    '0xcf55499e13bf758ddb9d40883c1e123ce18c2888': 'VaporDEX VLP',
  },
  knownLPPairs: {
    '0xf1840b4ae6dcc58e8dbe514510ffe7737b9acb47': 'FLD/WAVAX (TraderJoe V2)',
    '0x0dbcb787458fa66ba71b1b808008fee43edac252': 'FLD/WAVAX (VaporDEX)',
    '0x437705f77b5536dade2b3425475b72a0af5f1fe7': 'FLD/USDC',
    '0xcf55499e13bf758ddb9d40883c1e123ce18c2888': 'FLD/FATE (VaporDEX)',
    '0x3770ee1844d6ec809ad66e060518b18ba07f9ca4': 'MYST/FLD',
  },
};
