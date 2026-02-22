import { ethers } from 'ethers';
import { getTokenConfig, StakingContractConfig } from './token-configs';
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

/* ── Main: get staking positions for wallets ─────────────────────────────── */

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

  for (const sc of activeContracts) {
    if (sc.balanceMethod.encoding === 'abi-functions') {
      await processAbiFunctionContract(sc, wallets, tokenDecimals, lpReserves, results, tokenAddress);
    } else if (sc.balanceMethod.encoding === 'pid' || sc.balanceMethod.encoding === 'simple') {
      // Known method: batch-read directly
      await processKnownContract(sc, wallets, tokenDecimals, lpReserves, results);
    }
    // 'auto-detect' falls through to no-op if not handled above
  }

  return results;
}

/* ── Fetch LP pair reserves directly (for pairs not in discovery) ─────────── */

async function fetchLPReservesDirect(
  pairAddress: string,
  tokenAddress: string
): Promise<{ fldReserve: number; totalSupply: number } | null> {
  const pairIface = new ethers.Interface([
    'function token0() view returns (address)',
    'function getReserves() view returns (uint112, uint112, uint32)',
    'function totalSupply() view returns (uint256)',
  ]);

  try {
    const calls = [
      { target: pairAddress, allowFailure: true, callData: pairIface.encodeFunctionData('token0', []) },
      { target: pairAddress, allowFailure: true, callData: pairIface.encodeFunctionData('getReserves', []) },
      { target: pairAddress, allowFailure: true, callData: pairIface.encodeFunctionData('totalSupply', []) },
    ];

    const calldata = multicallIface.encodeFunctionData('aggregate3', [calls]);
    const raw = await provider.call({ to: MULTICALL3_ADDRESS, data: calldata });
    const decoded = multicallIface.decodeFunctionResult('aggregate3', raw);
    const responses = decoded[0] as Array<{ success: boolean; returnData: string }>;

    if (!responses[0].success || !responses[1].success || !responses[2].success) return null;

    const token0 = pairIface.decodeFunctionResult('token0', responses[0].returnData)[0] as string;
    const reserves = pairIface.decodeFunctionResult('getReserves', responses[1].returnData);
    const totalSupplyRaw = pairIface.decodeFunctionResult('totalSupply', responses[2].returnData)[0] as bigint;

    const r0 = reserves[0] as bigint;
    const r1 = reserves[1] as bigint;
    const fldIsToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
    const fldReserveRaw = fldIsToken0 ? r0 : r1;

    // FLD has 18 decimals, LP tokens have 18 decimals
    const fldReserve = Number(fldReserveRaw) / 1e18;
    const totalSupply = Number(totalSupplyRaw) / 1e18;

    if (totalSupply === 0) return null;
    return { fldReserve, totalSupply };
  } catch {
    return null;
  }
}

/* ── ABI-function-based staking (Ninety1) ────────────────────────────────── */

async function processAbiFunctionContract(
  sc: StakingContractConfig,
  wallets: string[],
  tokenDecimals: number,
  lpReserves: Record<string, { fldReserve: number; totalSupply: number }>,
  results: Record<string, StakingPosition[]>,
  tokenAddress: string
) {
  const fn = sc.balanceMethod.abiFunction;
  if (!fn) return;

  const abiSig = sc.balanceMethod.abiSignature || `function ${fn}(address) view returns (uint256)`;
  const iface = new ethers.Interface([abiSig]);

  // If this is an LP staking contract and reserves aren't already available, fetch them
  if (sc.stakedAsset === 'lp-token' && sc.lpPairAddress) {
    const lpKey = sc.lpPairAddress.toLowerCase();
    if (!lpReserves[lpKey]) {
      const directReserves = await fetchLPReservesDirect(sc.lpPairAddress, tokenAddress);
      if (directReserves) {
        lpReserves[lpKey] = directReserves;
      }
    }
  }

  // Determine if function takes 2 args: (address, address) — e.g. LPStakes(lpAddr, wallet)
  const isTwoArgLP = abiSig.includes('(address, address)') && sc.lpPairAddress;

  const calls: Array<{ target: string; allowFailure: boolean; callData: string }> = [];
  const callWallets: string[] = [];

  for (const wallet of wallets) {
    try {
      const args = isTwoArgLP ? [sc.lpPairAddress, wallet] : [wallet];
      const callData = iface.encodeFunctionData(fn, args);
      calls.push({ target: sc.address, allowFailure: true, callData });
      callWallets.push(wallet.toLowerCase());
    } catch {
      // skip encode failures
    }
  }

  if (calls.length === 0) return;

  const BATCH_SIZE = 100;
  for (let bi = 0; bi < calls.length; bi += BATCH_SIZE) {
    const batchCalls = calls.slice(bi, bi + BATCH_SIZE);
    const batchWallets = callWallets.slice(bi, bi + BATCH_SIZE);

    try {
      const calldata = multicallIface.encodeFunctionData('aggregate3', [batchCalls]);
      const raw = await provider.call({ to: MULTICALL3_ADDRESS, data: calldata });
      const decoded = multicallIface.decodeFunctionResult('aggregate3', raw);
      const responses = decoded[0] as Array<{ success: boolean; returnData: string }>;

      for (let i = 0; i < responses.length; i++) {
        if (!responses[i].success || responses[i].returnData === '0x') continue;

        try {
          const result = iface.decodeFunctionResult(fn, responses[i].returnData);
          const resultIdx = sc.balanceMethod.resultIndex ?? 0;
          const rawAmount = result[resultIdx] as bigint;
          if (rawAmount === BigInt(0)) continue;

          const decimals = sc.balanceMethod.decimals ?? 0;
          const stakedAmount = Number(rawAmount) / Math.pow(10, decimals);

          const position = buildPosition(sc, stakedAmount, tokenDecimals, lpReserves);
          if (!position) continue;

          const wallet = batchWallets[i];
          if (!results[wallet]) results[wallet] = [];
          results[wallet].push(position);
        } catch {
          // skip decode failures
        }
      }
    } catch {
      // batch failed
    }
  }
}

/* ── Known-method staking (MasterChef, balanceOf, etc.) ──────────────────── */

async function processKnownContract(
  sc: StakingContractConfig,
  wallets: string[],
  tokenDecimals: number,
  lpReserves: Record<string, { fldReserve: number; totalSupply: number }>,
  results: Record<string, StakingPosition[]>
) {
  const bm = sc.balanceMethod;
  const calls: Array<{ target: string; allowFailure: boolean; callData: string }> = [];
  const callWallets: string[] = [];

  for (const wallet of wallets) {
    let callData: string;
    if (bm.encoding === 'pid' && bm.pid !== undefined) {
      const iface = new ethers.Interface([
        'function userInfo(uint256, address) view returns (uint256, uint256)',
      ]);
      callData = iface.encodeFunctionData('userInfo', [bm.pid, wallet]);
    } else {
      const iface = new ethers.Interface([
        'function balanceOf(address) view returns (uint256)',
      ]);
      callData = iface.encodeFunctionData('balanceOf', [wallet]);
    }
    calls.push({ target: sc.address, allowFailure: true, callData });
    callWallets.push(wallet.toLowerCase());
  }

  const BATCH_SIZE = 100;
  for (let bi = 0; bi < calls.length; bi += BATCH_SIZE) {
    const batchCalls = calls.slice(bi, bi + BATCH_SIZE);
    const batchWallets = callWallets.slice(bi, bi + BATCH_SIZE);

    try {
      const calldata = multicallIface.encodeFunctionData('aggregate3', [batchCalls]);
      const raw = await provider.call({ to: MULTICALL3_ADDRESS, data: calldata });
      const decoded = multicallIface.decodeFunctionResult('aggregate3', raw);
      const responses = decoded[0] as Array<{ success: boolean; returnData: string }>;

      for (let i = 0; i < responses.length; i++) {
        if (!responses[i].success || responses[i].returnData === '0x') continue;

        try {
          let rawAmount: bigint;
          if (bm.encoding === 'pid') {
            const iface = new ethers.Interface([
              'function userInfo(uint256, address) view returns (uint256, uint256)',
            ]);
            const result = iface.decodeFunctionResult('userInfo', responses[i].returnData);
            rawAmount = result[bm.resultIndex ?? 0] as bigint;
          } else {
            const iface = new ethers.Interface([
              'function balanceOf(address) view returns (uint256)',
            ]);
            const result = iface.decodeFunctionResult('balanceOf', responses[i].returnData);
            rawAmount = result[0] as bigint;
          }

          if (rawAmount === BigInt(0)) continue;

          const decimals = bm.decimals ?? tokenDecimals;
          const stakedAmount = Number(rawAmount) / Math.pow(10, decimals);

          const position = buildPosition(sc, stakedAmount, tokenDecimals, lpReserves);
          if (!position) continue;

          const wallet = batchWallets[i];
          if (!results[wallet]) results[wallet] = [];
          results[wallet].push(position);
        } catch {
          // skip
        }
      }
    } catch {
      // batch failed
    }
  }
}

function buildPosition(
  sc: StakingContractConfig,
  stakedAmount: number,
  tokenDecimals: number,
  lpReserves: Record<string, { fldReserve: number; totalSupply: number }>
): StakingPosition | null {
  let underlyingFLD = 0;
  let lpShareOfFLD: number | undefined;
  let sharePercentage: number | undefined;

  if (sc.stakedAsset === 'lp-token' && sc.lpPairAddress) {
    const lpData = lpReserves[sc.lpPairAddress.toLowerCase()];
    if (lpData && lpData.totalSupply > 0) {
      sharePercentage = (stakedAmount / lpData.totalSupply) * 100;
      lpShareOfFLD = (stakedAmount / lpData.totalSupply) * lpData.fldReserve;
      underlyingFLD = lpShareOfFLD;
    }
  } else {
    underlyingFLD = stakedAmount;
  }

  if (underlyingFLD < 0.01) return null;

  return {
    contractAddress: sc.address,
    contractLabel: sc.label,
    stakedAsset: sc.stakedAsset,
    stakedAmount,
    underlyingFLD,
    lpPairAddress: sc.lpPairAddress,
    lpShareOfFLD,
    sharePercentage,
  };
}
