import { ethers } from 'ethers';
import { TransferTx, TokenInfo, CrossAssetLink } from './types';
import { AVAX_RPC, ROUTESCAN_API, SNOWSCAN_API, MULTICALL3_ADDRESS } from './constants';
import { fetchWithTimeout } from './fetch-with-timeout';

const provider = new ethers.JsonRpcProvider(AVAX_RPC);

const erc20Iface = new ethers.Interface([
  'function balanceOf(address) view returns (uint256)',
]);
const multicallIface = new ethers.Interface([
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])',
]);

// ─── Token Transfer Fetching ─────────────────────────────────────────────────

async function fetchFromExplorer(
  baseUrl: string,
  wallet: string,
  tokenAddress: string,
  limit: number
): Promise<TransferTx[] | null> {
  const params = new URLSearchParams({
    module: 'account',
    action: 'tokentx',
    contractaddress: tokenAddress,
    address: wallet,
    page: '1',
    offset: String(limit),
    sort: 'desc',
  });

  try {
    const res = await fetchWithTimeout(`${baseUrl}?${params}`, { next: { revalidate: 0 } }, 10_000);
    if (!res.ok) return null;

    const json = await res.json();
    if (json.status !== '1' || !Array.isArray(json.result)) return null;

    return json.result as TransferTx[];
  } catch {
    return null;
  }
}

async function fetchAllTokenTxFiltered(
  baseUrl: string,
  wallet: string,
  tokenAddress: string,
  limit: number
): Promise<TransferTx[] | null> {
  const params = new URLSearchParams({
    module: 'account',
    action: 'tokentx',
    address: wallet,
    page: '1',
    offset: String(Math.min(limit * 5, 10000)),
    sort: 'desc',
  });

  try {
    const res = await fetchWithTimeout(`${baseUrl}?${params}`, { next: { revalidate: 0 } }, 10_000);
    if (!res.ok) return null;

    const json = await res.json();
    if (json.status !== '1' || !Array.isArray(json.result)) return null;

    const tokenLower = tokenAddress.toLowerCase();
    const filtered = (json.result as TransferTx[]).filter(
      (tx) => tx.contractAddress.toLowerCase() === tokenLower
    );
    return filtered.slice(0, limit);
  } catch {
    return null;
  }
}

export async function fetchTokenTransfers(
  wallet: string,
  tokenAddress: string,
  limit: number = 1000
): Promise<TransferTx[]> {
  // Try Routescan with contract filter
  let result = await fetchFromExplorer(ROUTESCAN_API, wallet, tokenAddress, limit);
  if (result && result.length > 0) return result;

  // Fallback: Snowscan with contract filter
  result = await fetchFromExplorer(SNOWSCAN_API, wallet, tokenAddress, limit);
  if (result && result.length > 0) return result;

  // Fallback: fetch all tokentx, filter client-side
  result = await fetchAllTokenTxFiltered(ROUTESCAN_API, wallet, tokenAddress, limit);
  if (result && result.length > 0) return result;

  result = await fetchAllTokenTxFiltered(SNOWSCAN_API, wallet, tokenAddress, limit);
  return result ?? [];
}

// ─── Multicall3 Batch Balance Check ──────────────────────────────────────────

export async function getTokenBalanceBatch(
  wallets: string[],
  tokenAddress: string,
  decimals: number
): Promise<Record<string, number>> {
  if (wallets.length === 0) return {};

  const results: Record<string, number> = {};
  const BATCH_SIZE = 50; // smaller batches for production stability

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);

    const calls = batch.map((wallet) => ({
      target: tokenAddress,
      allowFailure: true,
      callData: erc20Iface.encodeFunctionData('balanceOf', [wallet]),
    }));

    try {
      const calldata = multicallIface.encodeFunctionData('aggregate3', [calls]);

      const rawResult = await provider.call({
        to: MULTICALL3_ADDRESS,
        data: calldata,
      });

      const decoded = multicallIface.decodeFunctionResult('aggregate3', rawResult);
      const responses = decoded[0] as Array<{ success: boolean; returnData: string }>;

      for (let j = 0; j < batch.length; j++) {
        const addr = batch[j].toLowerCase();
        try {
          if (responses[j].success && responses[j].returnData !== '0x') {
            const balance = erc20Iface.decodeFunctionResult(
              'balanceOf',
              responses[j].returnData
            )[0] as bigint;
            results[addr] = Number(balance) / Math.pow(10, decimals);
          } else {
            results[addr] = 0;
          }
        } catch {
          results[addr] = 0;
        }
      }
    } catch {
      await fallbackIndividualBalances(batch, tokenAddress, decimals, results);
    }
  }

  return results;
}

async function fallbackIndividualBalances(
  wallets: string[],
  tokenAddress: string,
  decimals: number,
  results: Record<string, number>
): Promise<void> {
  const PARALLEL = 10;
  for (let i = 0; i < wallets.length; i += PARALLEL) {
    const chunk = wallets.slice(i, i + PARALLEL);
    await Promise.all(
      chunk.map(async (wallet) => {
        try {
          const calldata = erc20Iface.encodeFunctionData('balanceOf', [wallet]);
          const raw = await provider.call({ to: tokenAddress, data: calldata });
          const balance = erc20Iface.decodeFunctionResult('balanceOf', raw)[0] as bigint;
          results[wallet.toLowerCase()] = Number(balance) / Math.pow(10, decimals);
        } catch {
          results[wallet.toLowerCase()] = 0;
        }
      })
    );
  }
}

// ─── Contract Detection ──────────────────────────────────────────────────────

export async function detectContracts(addresses: string[]): Promise<string[]> {
  const contracts: string[] = [];
  const BATCH_SIZE = 20;

  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (addr) => {
        try {
          const code = await provider.getCode(addr);
          return code !== '0x' && code !== '0x0' ? addr.toLowerCase() : null;
        } catch {
          return null;
        }
      })
    );
    contracts.push(...(batchResults.filter(Boolean) as string[]));
  }

  return contracts;
}

// ─── Funding Source Detection ─────────────────────────────────────────────────

export async function fetchFundingSources(
  wallets: string[]
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  const BATCH = 10;

  for (let i = 0; i < wallets.length; i += BATCH) {
    const batch = wallets.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(async (wallet) => {
        const addr = wallet.toLowerCase();
        const apis = [ROUTESCAN_API, SNOWSCAN_API];
        for (let a = 0; a < apis.length; a++) {
          try {
            const params = new URLSearchParams({
              module: 'account',
              action: 'txlist',
              address: addr,
              sort: 'asc',
              page: '1',
              offset: '5',
            });
            const res = await fetchWithTimeout(
              `${apis[a]}?${params}`,
              { next: { revalidate: 0 } },
              10_000
            );
            if (!res.ok) continue;
            const json = await res.json();
            if (json.status !== '1' || !Array.isArray(json.result)) continue;
            for (const tx of json.result) {
              if (
                tx.to?.toLowerCase() === addr &&
                tx.value &&
                BigInt(tx.value) > BigInt(0)
              ) {
                return { addr, funder: tx.from as string };
              }
            }
          } catch {
            continue;
          }
        }
        return { addr, funder: null as string | null };
      })
    );
    for (const { addr, funder } of batchResults) {
      if (funder) results[addr] = funder;
    }
  }

  return results;
}

// ─── Token Lookup ────────────────────────────────────────────────────────────

export async function lookupToken(address: string): Promise<TokenInfo | null> {
  const params = new URLSearchParams({
    module: 'account',
    action: 'tokentx',
    contractaddress: address,
    page: '1',
    offset: '1',
    sort: 'desc',
  });

  const apis = [ROUTESCAN_API, SNOWSCAN_API];
  for (let i = 0; i < apis.length; i++) {
    const baseUrl = apis[i];
    try {
      const res = await fetchWithTimeout(`${baseUrl}?${params}`, { next: { revalidate: 0 } }, 10_000);
      if (!res.ok) continue;

      const json = await res.json();
      if (json.status !== '1' || !Array.isArray(json.result) || json.result.length === 0) continue;

      const tx = json.result[0] as TransferTx;
      return {
        symbol: tx.tokenSymbol,
        name: tx.tokenName,
        address: tx.contractAddress,
        decimals: parseInt(tx.tokenDecimal, 10),
      };
    } catch {
      continue;
    }
  }

  return null;
}

// ─── Cross-Asset Correlation ──────────────────────────────────────────────────
// Fetches AVAX and stablecoin transfers between a set of wallets to detect
// cross-asset funding patterns (e.g. sending gas money or USDC to buy tokens).

const USDC_AVAX = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const USDT_AVAX = '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7';

interface RawNormalTx {
  from: string;
  to: string;
  value: string;
  timeStamp: string;
}

async function fetchNormalTxs(
  wallet: string,
  limit: number = 200
): Promise<RawNormalTx[]> {
  const apis = [ROUTESCAN_API, SNOWSCAN_API];
  for (const baseUrl of apis) {
    try {
      const params = new URLSearchParams({
        module: 'account',
        action: 'txlist',
        address: wallet,
        page: '1',
        offset: String(limit),
        sort: 'desc',
      });
      const res = await fetchWithTimeout(
        `${baseUrl}?${params}`,
        { next: { revalidate: 0 } },
        10_000
      );
      if (!res.ok) continue;
      const json = await res.json();
      if (json.status !== '1' || !Array.isArray(json.result)) continue;
      return json.result as RawNormalTx[];
    } catch {
      continue;
    }
  }
  return [];
}

async function fetchStablecoinTxs(
  wallet: string,
  stablecoin: string,
  limit: number = 200
): Promise<TransferTx[]> {
  const apis = [ROUTESCAN_API, SNOWSCAN_API];
  for (const baseUrl of apis) {
    try {
      const params = new URLSearchParams({
        module: 'account',
        action: 'tokentx',
        contractaddress: stablecoin,
        address: wallet,
        page: '1',
        offset: String(limit),
        sort: 'desc',
      });
      const res = await fetchWithTimeout(
        `${baseUrl}?${params}`,
        { next: { revalidate: 0 } },
        10_000
      );
      if (!res.ok) continue;
      const json = await res.json();
      if (json.status !== '1' || !Array.isArray(json.result)) continue;
      return json.result as TransferTx[];
    } catch {
      continue;
    }
  }
  return [];
}

export async function fetchCrossAssetLinks(
  wallets: string[]
): Promise<CrossAssetLink[]> {
  if (wallets.length < 2) return [];

  const walletSet = new Set(wallets.map((w) => w.toLowerCase()));
  const linkMap = new Map<string, CrossAssetLink>();

  function addLink(
    from: string,
    to: string,
    asset: 'AVAX' | 'USDC' | 'USDT',
    value: number,
    ts: number
  ) {
    const key = `${from}->${to}:${asset}`;
    const existing = linkMap.get(key);
    if (existing) {
      existing.value += value;
      existing.txCount++;
      existing.firstSeen = Math.min(existing.firstSeen, ts);
      existing.lastSeen = Math.max(existing.lastSeen, ts);
    } else {
      linkMap.set(key, {
        from,
        to,
        asset,
        value,
        txCount: 1,
        firstSeen: ts,
        lastSeen: ts,
      });
    }
  }

  // Fetch in batches of 5 to avoid rate limits
  const BATCH = 5;
  for (let i = 0; i < wallets.length; i += BATCH) {
    const batch = wallets.slice(i, i + BATCH);

    const results = await Promise.all(
      batch.map(async (wallet) => {
        const addr = wallet.toLowerCase();
        const [normalTxs, usdcTxs, usdtTxs] = await Promise.all([
          fetchNormalTxs(addr, 200),
          fetchStablecoinTxs(addr, USDC_AVAX, 200),
          fetchStablecoinTxs(addr, USDT_AVAX, 200),
        ]);
        return { addr, normalTxs, usdcTxs, usdtTxs };
      })
    );

    for (const { addr, normalTxs, usdcTxs, usdtTxs } of results) {
      // AVAX transfers between cluster wallets
      for (const tx of normalTxs) {
        const from = tx.from.toLowerCase();
        const to = (tx.to || '').toLowerCase();
        if (!to) continue;
        const val = Number(BigInt(tx.value || '0')) / 1e18;
        if (val < 0.001) continue; // ignore dust
        const ts = parseInt(tx.timeStamp, 10);

        if (from === addr && walletSet.has(to) && to !== addr) {
          addLink(from, to, 'AVAX', val, ts);
        } else if (to === addr && walletSet.has(from) && from !== addr) {
          addLink(from, to, 'AVAX', val, ts);
        }
      }

      // USDC transfers between cluster wallets
      for (const tx of usdcTxs) {
        const from = tx.from.toLowerCase();
        const to = tx.to.toLowerCase();
        const val = parseFloat(tx.value) / 1e6; // USDC has 6 decimals
        if (val < 0.01) continue;
        const ts = parseInt(tx.timeStamp, 10);

        if (from === addr && walletSet.has(to) && to !== addr) {
          addLink(from, to, 'USDC', val, ts);
        } else if (to === addr && walletSet.has(from) && from !== addr) {
          addLink(from, to, 'USDC', val, ts);
        }
      }

      // USDT transfers between cluster wallets
      for (const tx of usdtTxs) {
        const from = tx.from.toLowerCase();
        const to = tx.to.toLowerCase();
        const val = parseFloat(tx.value) / 1e6; // USDT has 6 decimals
        if (val < 0.01) continue;
        const ts = parseInt(tx.timeStamp, 10);

        if (from === addr && walletSet.has(to) && to !== addr) {
          addLink(from, to, 'USDT', val, ts);
        } else if (to === addr && walletSet.has(from) && from !== addr) {
          addLink(from, to, 'USDT', val, ts);
        }
      }
    }

    // Rate limit between batches
    if (i + BATCH < wallets.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  return Array.from(linkMap.values());
}

// ─── Cross-Asset Peer Discovery ─────────────────────────────────────────────
// Finds wallets that the target sent/received AVAX or stablecoins to/from
// but that are NOT already known. These are candidates for "hidden" wallets
// that have no token transfer link but share gas/stablecoin funding.

export async function discoverCrossAssetPeers(
  targetWallet: string,
  knownAddresses: Set<string>
): Promise<string[]> {
  const target = targetWallet.toLowerCase();
  const discovered = new Set<string>();

  // Fetch target's AVAX transactions and stablecoin transfers
  const [normalTxs, usdcTxs, usdtTxs] = await Promise.all([
    fetchNormalTxs(target, 500),
    fetchStablecoinTxs(target, USDC_AVAX, 200),
    fetchStablecoinTxs(target, USDT_AVAX, 200),
  ]);

  // Find AVAX peers not already known
  for (const tx of normalTxs) {
    const from = tx.from.toLowerCase();
    const to = (tx.to || '').toLowerCase();
    if (!to) continue;
    const val = Number(BigInt(tx.value || '0')) / 1e18;
    if (val < 0.01) continue; // ignore dust

    const peer = from === target ? to : from;
    if (peer !== target && !knownAddresses.has(peer)) {
      discovered.add(peer);
    }
  }

  // Find stablecoin peers not already known
  for (const tx of [...usdcTxs, ...usdtTxs]) {
    const from = tx.from.toLowerCase();
    const to = tx.to.toLowerCase();
    const peer = from === target ? to : from;
    if (peer !== target && !knownAddresses.has(peer)) {
      discovered.add(peer);
    }
  }

  return Array.from(discovered);
}
