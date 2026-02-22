import { ethers } from 'ethers';
import { getTokenConfig } from './token-configs';
import { AVAX_RPC, MULTICALL3_ADDRESS } from './constants';

const provider = new ethers.JsonRpcProvider(AVAX_RPC);

const multicallIface = new ethers.Interface([
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])',
]);

export interface StakingPosition {
  contractAddress: string;
  contractLabel: string;
  stakedAsset: 'token' | 'lp-token';
  stakedAmount: number;
  underlyingFLD: number;
  lpPairAddress?: string;
  lpShareOfFLD?: number;
  sharePercentage?: number;
}

/**
 * Check staking positions for a list of wallets using the token-specific config.
 * Returns empty results for tokens without a registered config (generic tokens).
 *
 * LP reserve data is passed in from the existing LP detection to convert
 * staked-LP-tokens into their underlying FLD value.
 */
export async function getStakingPositions(
  wallets: string[],
  tokenAddress: string,
  tokenDecimals: number,
  lpReserves: Record<string, { fldReserve: number; totalSupply: number }>
): Promise<Record<string, StakingPosition[]>> {
  const config = getTokenConfig(tokenAddress);
  if (!config || config.stakingContracts.length === 0 || wallets.length === 0) {
    return {};
  }

  // Filter out placeholder addresses
  const activeContracts = config.stakingContracts.filter(
    (sc) => !sc.address.startsWith('0xTODO')
  );
  if (activeContracts.length === 0) return {};

  const results: Record<string, StakingPosition[]> = {};

  // Build multicall batch: for each wallet × each staking contract
  const calls: Array<{ target: string; allowFailure: boolean; callData: string }> = [];
  const callMeta: Array<{ wallet: string; contractIdx: number }> = [];

  for (const wallet of wallets) {
    for (let ci = 0; ci < activeContracts.length; ci++) {
      const sc = activeContracts[ci];
      const bm = sc.balanceMethod;

      let callData: string;
      if (bm.encoding === 'pid' && bm.pid !== undefined) {
        // MasterChef-style: userInfo(uint256 pid, address user)
        const iface = new ethers.Interface([
          'function userInfo(uint256, address) view returns (uint256, uint256)',
        ]);
        callData = iface.encodeFunctionData('userInfo', [bm.pid, wallet]);
      } else {
        // Simple: balanceOf(address)
        const iface = new ethers.Interface([
          'function balanceOf(address) view returns (uint256)',
        ]);
        callData = iface.encodeFunctionData('balanceOf', [wallet]);
      }

      calls.push({ target: sc.address, allowFailure: true, callData });
      callMeta.push({ wallet: wallet.toLowerCase(), contractIdx: ci });
    }
  }

  // Execute multicall in batches of 100
  const BATCH_SIZE = 100;
  for (let bi = 0; bi < calls.length; bi += BATCH_SIZE) {
    const batchCalls = calls.slice(bi, bi + BATCH_SIZE);
    const batchMeta = callMeta.slice(bi, bi + BATCH_SIZE);

    try {
      const calldata = multicallIface.encodeFunctionData('aggregate3', [batchCalls]);
      const raw = await provider.call({ to: MULTICALL3_ADDRESS, data: calldata });
      const decoded = multicallIface.decodeFunctionResult('aggregate3', raw);
      const responses = decoded[0] as Array<{ success: boolean; returnData: string }>;

      for (let i = 0; i < responses.length; i++) {
        if (!responses[i].success || responses[i].returnData === '0x') continue;

        const { wallet, contractIdx } = batchMeta[i];
        const sc = activeContracts[contractIdx];
        const bm = sc.balanceMethod;
        const decimals = bm.decimals ?? tokenDecimals;

        try {
          let rawAmount: bigint;

          if (bm.encoding === 'pid') {
            // Decode userInfo return (amount, rewardDebt)
            const iface = new ethers.Interface([
              'function userInfo(uint256, address) view returns (uint256, uint256)',
            ]);
            const decoded = iface.decodeFunctionResult('userInfo', responses[i].returnData);
            rawAmount = decoded[bm.resultIndex ?? 0] as bigint;
          } else {
            const iface = new ethers.Interface([
              'function balanceOf(address) view returns (uint256)',
            ]);
            const decoded = iface.decodeFunctionResult('balanceOf', responses[i].returnData);
            rawAmount = decoded[0] as bigint;
          }

          if (rawAmount === BigInt(0)) continue;

          const stakedAmount = Number(rawAmount) / Math.pow(10, decimals);
          let underlyingFLD = 0;
          let lpShareOfFLD: number | undefined;
          let sharePercentage: number | undefined;

          if (sc.stakedAsset === 'lp-token' && sc.lpPairAddress) {
            // Convert staked LP tokens → underlying FLD
            const lpData = lpReserves[sc.lpPairAddress.toLowerCase()];
            if (lpData && lpData.totalSupply > 0) {
              // stakedAmount is in LP token units (18 decimals)
              sharePercentage = (stakedAmount / lpData.totalSupply) * 100;
              lpShareOfFLD = (stakedAmount / lpData.totalSupply) * lpData.fldReserve;
              underlyingFLD = lpShareOfFLD;
            }
          } else {
            // Direct token stake
            underlyingFLD = stakedAmount;
          }

          if (underlyingFLD < 0.01) continue; // skip dust

          if (!results[wallet]) results[wallet] = [];
          results[wallet].push({
            contractAddress: sc.address,
            contractLabel: sc.label,
            stakedAsset: sc.stakedAsset,
            stakedAmount,
            underlyingFLD,
            lpPairAddress: sc.lpPairAddress,
            lpShareOfFLD,
            sharePercentage,
          });
        } catch {
          // skip decode failures
        }
      }
    } catch {
      // batch failed, continue
    }
  }

  return results;
}
