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
    encoding: 'simple' | 'pid';
    pid?: number;
    resultIndex?: number;
    decimals?: number;
  };
  stakedAsset: 'token' | 'lp-token';
  lpPairAddress?: string;
}

export interface TokenConfig {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chain: 'avax';
  stakingContracts: StakingContractConfig[];
  knownEcosystemContracts: Record<string, string>;
}

const TOKEN_CONFIGS: Record<string, TokenConfig> = {};

export function getTokenConfig(tokenAddress: string): TokenConfig | null {
  return TOKEN_CONFIGS[tokenAddress.toLowerCase()] || null;
}

// ═══════════════════════════════════════════════════
// FLD (FOLD) — Lab91 Ecosystem
// ═══════════════════════════════════════════════════
// TO COMPLETE THIS CONFIG:
// 1. Find the Lab91 staking/farm contract address on Snowscan
//    Look for the contract that users deposit FLD/AVAX LP tokens into
// 2. Check the contract's read functions to find the balance method:
//    - MasterChef-style: usually userInfo(pid, address)
//    - Simple staking: usually balanceOf(address) or stakedAmount(address)
// 3. Find the pool ID (pid) for the FLD/AVAX pool (usually 0 or 1)
// 4. Find the FLD/AVAX LP pair contract address
//    - Go to TraderJoe, look at the FLD/AVAX pool info
//    - Or call getPair on the TraderJoe factory
// 5. Replace all TODO addresses below with real addresses
// 6. Test by checking a wallet known to be staking FLD on Lab91
// ═══════════════════════════════════════════════════

TOKEN_CONFIGS['0x88f89be3e9b1dc1c5f208696fb9cabfcc684bd5f'] = {
  address: '0x88f89be3e9b1dc1c5f208696fb9cabfcc684bd5f',
  symbol: 'FLD',
  name: 'Fold',
  decimals: 18,
  chain: 'avax',
  stakingContracts: [
    {
      // TODO: Replace with actual Lab91 staking contract address
      address: '0xTODO_LAB91_FLD_AVAX_FARM',
      label: 'Lab91 FLD/AVAX Farm',
      type: 'masterchef',
      balanceMethod: {
        // MasterChef-style: userInfo(uint256 pid, address user) returns (uint256 amount, ...)
        // TODO: Confirm the actual function signature on the Lab91 contract
        selector: '0x93f1a40b', // userInfo(uint256,address)
        encoding: 'pid',
        pid: 0, // TODO: Confirm FLD/AVAX pool ID
        resultIndex: 0,
      },
      stakedAsset: 'lp-token',
      lpPairAddress: '0xTODO_FLD_AVAX_LP_PAIR', // TODO: the TraderJoe or Pangolin FLD/AVAX pair
    },
    // Add more staking pools here if Lab91 has multiple farms
    // {
    //   address: '0xTODO_LAB91_SINGLE_STAKE',
    //   label: 'Lab91 FLD Single Stake',
    //   type: 'single-stake',
    //   balanceMethod: {
    //     selector: '0x70a08231',  // standard balanceOf(address)
    //     encoding: 'simple',
    //   },
    //   stakedAsset: 'token',
    // },
  ],
  knownEcosystemContracts: {
    // TODO: Add Lab91 ecosystem contract addresses
    // '0xTODO': 'Lab91 Rewards Distributor',
    // '0xTODO': 'Lab91 Treasury',
  },
};
