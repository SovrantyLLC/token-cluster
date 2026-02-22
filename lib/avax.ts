import { ethers } from 'ethers';
import { TransferTx, TokenInfo } from './types';
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
