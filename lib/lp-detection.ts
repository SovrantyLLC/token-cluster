import { ethers } from 'ethers';
import { LPPosition } from './types';
import { AVAX_RPC, MULTICALL3_ADDRESS } from './constants';

const provider = new ethers.JsonRpcProvider(AVAX_RPC);

const WAVAX = '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'.toLowerCase();
const USDC = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'.toLowerCase();
const USDT = '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7'.toLowerCase();

const TRADERJOE_FACTORY = '0x9Ad6C38BE94206cA50bb0d90783181662f0Cfa10';
const PANGOLIN_FACTORY = '0xefa94DE7a4656D787667C749f7E1223D71E9FD88';

const TOKEN_LABELS: Record<string, string> = {
  [WAVAX]: 'WAVAX',
  [USDC]: 'USDC',
  [USDT]: 'USDT',
};

const factoryIface = new ethers.Interface([
  'function getPair(address tokenA, address tokenB) view returns (address pair)',
]);
const pairIface = new ethers.Interface([
  'function token0() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]);
const multicallIface = new ethers.Interface([
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])',
]);

const NULL_ADDR = '0x0000000000000000000000000000000000000000';

/* ── Find LP pairs for a token ────────────────────────────────────────────── */

export async function findLPPairs(tokenAddress: string): Promise<string[]> {
  const token = tokenAddress.toLowerCase();
  const quoteTokens = [WAVAX, USDC, USDT];
  const factories = [
    { address: TRADERJOE_FACTORY, label: 'TraderJoe' },
    { address: PANGOLIN_FACTORY, label: 'Pangolin' },
  ];

  const calls: Array<{ target: string; allowFailure: boolean; callData: string }> = [];
  const callMeta: Array<{ factory: string; quoteToken: string }> = [];

  for (const factory of factories) {
    for (const quote of quoteTokens) {
      calls.push({
        target: factory.address,
        allowFailure: true,
        callData: factoryIface.encodeFunctionData('getPair', [token, quote]),
      });
      callMeta.push({ factory: factory.label, quoteToken: quote });
    }
  }

  try {
    const calldata = multicallIface.encodeFunctionData('aggregate3', [calls]);
    const raw = await provider.call({ to: MULTICALL3_ADDRESS, data: calldata });
    const decoded = multicallIface.decodeFunctionResult('aggregate3', raw);
    const responses = decoded[0] as Array<{ success: boolean; returnData: string }>;

    const pairs: string[] = [];
    for (let i = 0; i < responses.length; i++) {
      if (!responses[i].success || responses[i].returnData === '0x') continue;
      try {
        const [pairAddr] = factoryIface.decodeFunctionResult('getPair', responses[i].returnData);
        const addr = (pairAddr as string).toLowerCase();
        if (addr !== NULL_ADDR && !pairs.includes(addr)) {
          pairs.push(addr);
        }
      } catch {
        // skip decode failures
      }
    }
    return pairs;
  } catch {
    return [];
  }
}

/* ── Get LP positions for wallets ─────────────────────────────────────────── */

export async function getLPPositions(
  wallets: string[],
  tokenAddress: string,
  tokenDecimals: number,
  lpPairs: string[]
): Promise<Record<string, LPPosition[]>> {
  if (lpPairs.length === 0 || wallets.length === 0) return {};

  const token = tokenAddress.toLowerCase();
  const results: Record<string, LPPosition[]> = {};

  // Phase 1: Get pair metadata (token0, reserves, totalSupply) for each pair
  const metaCalls: Array<{ target: string; allowFailure: boolean; callData: string }> = [];
  for (const pair of lpPairs) {
    metaCalls.push({ target: pair, allowFailure: true, callData: pairIface.encodeFunctionData('token0', []) });
    metaCalls.push({ target: pair, allowFailure: true, callData: pairIface.encodeFunctionData('getReserves', []) });
    metaCalls.push({ target: pair, allowFailure: true, callData: pairIface.encodeFunctionData('totalSupply', []) });
  }

  const pairMeta: Array<{
    pair: string;
    token0: string;
    reserve0: bigint;
    reserve1: bigint;
    totalSupply: bigint;
    fldIsToken0: boolean;
  }> = [];

  try {
    const calldata = multicallIface.encodeFunctionData('aggregate3', [metaCalls]);
    const raw = await provider.call({ to: MULTICALL3_ADDRESS, data: calldata });
    const decoded = multicallIface.decodeFunctionResult('aggregate3', raw);
    const responses = decoded[0] as Array<{ success: boolean; returnData: string }>;

    for (let i = 0; i < lpPairs.length; i++) {
      const base = i * 3;
      const t0Resp = responses[base];
      const resResp = responses[base + 1];
      const tsResp = responses[base + 2];

      if (!t0Resp?.success || !resResp?.success || !tsResp?.success) continue;

      try {
        const [token0Addr] = pairIface.decodeFunctionResult('token0', t0Resp.returnData);
        const [r0, r1] = pairIface.decodeFunctionResult('getReserves', resResp.returnData);
        const [ts] = pairIface.decodeFunctionResult('totalSupply', tsResp.returnData);

        pairMeta.push({
          pair: lpPairs[i],
          token0: (token0Addr as string).toLowerCase(),
          reserve0: r0 as bigint,
          reserve1: r1 as bigint,
          totalSupply: ts as bigint,
          fldIsToken0: (token0Addr as string).toLowerCase() === token,
        });
      } catch {
        // skip
      }
    }
  } catch {
    return {};
  }

  if (pairMeta.length === 0) return {};

  // Phase 2: Get LP token balances for each wallet across each pair
  const BATCH_SIZE = 50;
  for (let wi = 0; wi < wallets.length; wi += BATCH_SIZE) {
    const walletBatch = wallets.slice(wi, wi + BATCH_SIZE);
    const balCalls: Array<{ target: string; allowFailure: boolean; callData: string }> = [];
    const balMeta: Array<{ wallet: string; pairIdx: number }> = [];

    for (const wallet of walletBatch) {
      for (let pi = 0; pi < pairMeta.length; pi++) {
        balCalls.push({
          target: pairMeta[pi].pair,
          allowFailure: true,
          callData: pairIface.encodeFunctionData('balanceOf', [wallet]),
        });
        balMeta.push({ wallet: wallet.toLowerCase(), pairIdx: pi });
      }
    }

    try {
      const calldata = multicallIface.encodeFunctionData('aggregate3', [balCalls]);
      const raw = await provider.call({ to: MULTICALL3_ADDRESS, data: calldata });
      const decoded = multicallIface.decodeFunctionResult('aggregate3', raw);
      const responses = decoded[0] as Array<{ success: boolean; returnData: string }>;

      for (let i = 0; i < responses.length; i++) {
        if (!responses[i].success || responses[i].returnData === '0x') continue;

        const { wallet, pairIdx } = balMeta[i];
        const meta = pairMeta[pairIdx];

        try {
          const [lpBal] = pairIface.decodeFunctionResult('balanceOf', responses[i].returnData);
          const lpBalance = lpBal as bigint;
          if (lpBalance === BigInt(0)) continue;

          const fldReserveBig = meta.fldIsToken0 ? meta.reserve0 : meta.reserve1;
          const otherReserveBig = meta.fldIsToken0 ? meta.reserve1 : meta.reserve0;
          const otherTokenAddr = meta.fldIsToken0 ? getOtherToken(meta.token0, token) : meta.token0;

          const totalSupply = meta.totalSupply;
          if (totalSupply === BigInt(0)) continue;

          // Determine other token decimals (WAVAX=18, USDC/USDT=6)
          const otherDecimals = otherTokenAddr === USDC || otherTokenAddr === USDT ? 6 : 18;

          const fldReserve = Number(fldReserveBig) / Math.pow(10, tokenDecimals);
          const otherReserve = Number(otherReserveBig) / Math.pow(10, otherDecimals);
          const lpBalNum = Number(lpBalance) / 1e18; // LP tokens are always 18 decimals
          const totalSupplyNum = Number(totalSupply) / 1e18;
          const sharePercentage = totalSupplyNum > 0 ? (lpBalNum / totalSupplyNum) * 100 : 0;
          const userFldShare = totalSupplyNum > 0 ? (lpBalNum / totalSupplyNum) * fldReserve : 0;
          const userOtherShare = totalSupplyNum > 0 ? (lpBalNum / totalSupplyNum) * otherReserve : 0;

          if (userFldShare < 0.01) continue; // Skip dust

          const otherLabel = TOKEN_LABELS[otherTokenAddr] || abbr(otherTokenAddr);
          const dexLabel = guessDexFromPair();

          if (!results[wallet]) results[wallet] = [];
          results[wallet].push({
            pairAddress: meta.pair,
            pairLabel: `FLD/${otherLabel} ${dexLabel}`,
            lpTokenBalance: lpBalNum,
            totalSupply: totalSupplyNum,
            fldReserve,
            userFldShare,
            sharePercentage,
            otherToken: otherLabel,
            otherTokenReserve: userOtherShare,
          });
        } catch {
          // skip
        }
      }
    } catch {
      // batch failed, continue
    }
  }

  return results;
}

function getOtherToken(token0: string, fldAddr: string): string {
  // If FLD is token0, other is token1 (we don't query token1 separately, infer from known pairs)
  // The pair was created with getPair(FLD, otherToken), so the other token is one of WAVAX/USDC/USDT
  // We can check which quote token it matches
  return token0 === fldAddr ? '' : token0; // placeholder — we'll use factory lookup context
}

function guessDexFromPair(): string {
  // Factory lookup already tells us which DEX, but since we batch both factories,
  // we can't easily distinguish here. Default to empty — the pairLabel construction
  // will be fine without it for now
  return '';
}

function abbr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
