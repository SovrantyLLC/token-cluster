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

// Cache discovered read methods so we only probe once per session
const discoveredMethods = new Map<string, {
  selector: string;
  encoding: 'simple' | 'pid';
  pid?: number;
  resultIndex: number;
  label: string;
} | null>();

/* ── Find a recent staker from Deposit events ───────────────────────────── */

async function findRecentStaker(
  stakingContract: string,
  depositEventSig?: string
): Promise<string | null> {
  const topic0 = depositEventSig ||
    '0xe31c7b8d08ee7db0afa68782e1028ef92305caeea8626633ad44d413e30f6b2f';

  try {
    const latestBlock = await provider.getBlockNumber();
    // Search last ~50k blocks (~2 days on AVAX)
    const fromBlock = Math.max(0, latestBlock - 50000);

    const logs = await provider.getLogs({
      address: stakingContract,
      topics: [topic0],
      fromBlock,
      toBlock: latestBlock,
    });

    if (logs.length === 0) return null;

    // Get user address from the most recent deposit event
    // Deposit(address user, uint256 amount, address recipient)
    // The user is in the first indexed topic or in the data
    const lastLog = logs[logs.length - 1];

    // Try to extract user from topics (if indexed)
    if (lastLog.topics.length >= 2) {
      const userAddr = '0x' + lastLog.topics[1].slice(26);
      if (ethers.isAddress(userAddr)) return userAddr;
    }

    // Try to extract from data (non-indexed)
    if (lastLog.data.length >= 66) {
      const userAddr = '0x' + lastLog.data.slice(26, 66);
      if (ethers.isAddress(userAddr)) return userAddr;
    }

    return null;
  } catch {
    return null;
  }
}

/* ── Probe staking contract to discover read method ─────────────────────── */

interface ProbeCandidate {
  label: string;
  iface: ethers.Interface;
  fnName: string;
  args: (wallet: string, lpAddress?: string) => unknown[];
  encoding: 'simple' | 'pid';
  pid?: number;
  resultIndex: number;
}

function buildProbeCandidates(lpTokenAddress?: string): ProbeCandidate[] {
  const candidates: ProbeCandidate[] = [
    {
      label: 'balanceOf(address)',
      iface: new ethers.Interface(['function balanceOf(address) view returns (uint256)']),
      fnName: 'balanceOf',
      args: (w) => [w],
      encoding: 'simple',
      resultIndex: 0,
    },
    {
      label: 'userInfo(address)',
      iface: new ethers.Interface(['function userInfo(address) view returns (uint256)']),
      fnName: 'userInfo',
      args: (w) => [w],
      encoding: 'simple',
      resultIndex: 0,
    },
    {
      label: 'userInfo(uint256,address) pid=0',
      iface: new ethers.Interface(['function userInfo(uint256, address) view returns (uint256, uint256)']),
      fnName: 'userInfo',
      args: (w) => [0, w],
      encoding: 'pid',
      pid: 0,
      resultIndex: 0,
    },
    {
      label: 'stakedBalance(address)',
      iface: new ethers.Interface(['function stakedBalance(address) view returns (uint256)']),
      fnName: 'stakedBalance',
      args: (w) => [w],
      encoding: 'simple',
      resultIndex: 0,
    },
  ];

  if (lpTokenAddress) {
    candidates.push(
      {
        label: 'getUserInfo(address,address)',
        iface: new ethers.Interface(['function getUserInfo(address, address) view returns (uint256)']),
        fnName: 'getUserInfo',
        args: (w, lp) => [w, lp],
        encoding: 'simple',
        resultIndex: 0,
      },
      {
        label: 'deposited(address,address)',
        iface: new ethers.Interface(['function deposited(address, address) view returns (uint256)']),
        fnName: 'deposited',
        args: (w, lp) => [w, lp],
        encoding: 'simple',
        resultIndex: 0,
      },
    );
  }

  return candidates;
}

async function probeStakingBalance(
  stakingContract: string,
  testWallet: string,
  lpTokenAddress?: string
): Promise<{ selector: string; encoding: 'simple' | 'pid'; pid?: number; resultIndex: number; label: string } | null> {
  const cacheKey = stakingContract.toLowerCase();
  if (discoveredMethods.has(cacheKey)) {
    return discoveredMethods.get(cacheKey) || null;
  }

  const candidates = buildProbeCandidates(lpTokenAddress);
  const calls: Array<{ target: string; allowFailure: boolean; callData: string }> = [];

  for (const c of candidates) {
    try {
      const args = c.args(testWallet, lpTokenAddress);
      const callData = c.iface.encodeFunctionData(c.fnName, args);
      calls.push({ target: stakingContract, allowFailure: true, callData });
    } catch {
      calls.push({ target: stakingContract, allowFailure: true, callData: '0x' });
    }
  }

  try {
    const calldata = multicallIface.encodeFunctionData('aggregate3', [calls]);
    const raw = await provider.call({ to: MULTICALL3_ADDRESS, data: calldata });
    const decoded = multicallIface.decodeFunctionResult('aggregate3', raw);
    const responses = decoded[0] as Array<{ success: boolean; returnData: string }>;

    for (let i = 0; i < responses.length; i++) {
      if (!responses[i].success || responses[i].returnData === '0x') continue;
      if (responses[i].returnData.length < 66) continue;

      try {
        const c = candidates[i];
        const args = c.args(testWallet, lpTokenAddress);
        const result = c.iface.decodeFunctionResult(c.fnName, responses[i].returnData);
        const amount = result[c.resultIndex] as bigint;

        if (amount > BigInt(0)) {
          const selector = c.iface.getFunction(c.fnName)?.selector || '';
          const method = {
            selector,
            encoding: c.encoding,
            pid: c.pid,
            resultIndex: c.resultIndex,
            label: c.label,
            _args: args, // stash for later use
          };
          discoveredMethods.set(cacheKey, method);
          return method;
        }
      } catch {
        // decode failed for this candidate, try next
      }
    }
  } catch {
    // multicall failed
  }

  discoveredMethods.set(cacheKey, null);
  return null;
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
    if (sc.balanceMethod.encoding === 'auto-detect') {
      // Auto-detect: find a known staker, probe the contract, then batch-read
      await processAutoDetectContract(sc, wallets, tokenDecimals, lpReserves, results);
    } else {
      // Known method: batch-read directly
      await processKnownContract(sc, wallets, tokenDecimals, lpReserves, results);
    }
  }

  return results;
}

async function processAutoDetectContract(
  sc: StakingContractConfig,
  wallets: string[],
  tokenDecimals: number,
  lpReserves: Record<string, { fldReserve: number; totalSupply: number }>,
  results: Record<string, StakingPosition[]>
) {
  // Step 1: Find a recent staker to use as test wallet
  let testWallet = await findRecentStaker(sc.address, sc.depositEventSignature);

  // If no recent staker found from events, try the first few wallets from our list
  if (!testWallet) {
    for (const w of wallets.slice(0, 5)) {
      testWallet = w;
      break;
    }
  }
  if (!testWallet) return;

  // Step 2: Probe to discover the read method
  const method = await probeStakingBalance(sc.address, testWallet, sc.lpPairAddress);
  if (!method) return;

  // Step 3: Build the matching candidate to encode calls
  const candidates = buildProbeCandidates(sc.lpPairAddress);
  const matchedCandidate = candidates.find((c) => c.label === method.label);
  if (!matchedCandidate) return;

  // Step 4: Batch-read all wallets
  const calls: Array<{ target: string; allowFailure: boolean; callData: string }> = [];
  const callWallets: string[] = [];

  for (const wallet of wallets) {
    try {
      const args = matchedCandidate.args(wallet, sc.lpPairAddress);
      const callData = matchedCandidate.iface.encodeFunctionData(matchedCandidate.fnName, args);
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
          const result = matchedCandidate.iface.decodeFunctionResult(
            matchedCandidate.fnName,
            responses[i].returnData
          );
          const rawAmount = result[matchedCandidate.resultIndex] as bigint;
          if (rawAmount === BigInt(0)) continue;

          const decimals = sc.balanceMethod.decimals ?? 18; // LP tokens are 18 decimals
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
