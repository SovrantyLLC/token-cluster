import { NextRequest, NextResponse } from 'next/server';
import { ROUTESCAN_API, SNOWSCAN_API } from '@/lib/constants';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { fetchWithTimeout, withOverallTimeout } from '@/lib/fetch-with-timeout';

interface FundingBody {
  wallets: string[];
}

async function fetchFirstAvaxTx(
  baseUrl: string,
  wallet: string
): Promise<string | null> {
  const params = new URLSearchParams({
    module: 'account',
    action: 'txlist',
    address: wallet,
    sort: 'asc',
    page: '1',
    offset: '5',
  });

  try {
    const res = await fetchWithTimeout(`${baseUrl}?${params}`, { next: { revalidate: 0 } }, 10_000);
    if (!res.ok) return null;

    const json = await res.json();
    if (json.status !== '1' || !Array.isArray(json.result)) return null;

    for (const tx of json.result) {
      if (
        tx.to?.toLowerCase() === wallet.toLowerCase() &&
        tx.value &&
        BigInt(tx.value) > BigInt(0)
      ) {
        return tx.from;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function runFundingLookup(wallets: string[]): Promise<Record<string, string>> {
  const limited = wallets.slice(0, 50);
  const results: Record<string, string> = {};

  const BATCH = 10;
  for (let i = 0; i < limited.length; i += BATCH) {
    const batch = limited.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(async (wallet) => {
        const addr = wallet.toLowerCase();
        let funder = await fetchFirstAvaxTx(ROUTESCAN_API, addr);
        if (!funder) {
          funder = await fetchFirstAvaxTx(SNOWSCAN_API, addr);
        }
        return { addr, funder };
      })
    );

    for (const { addr, funder } of batchResults) {
      if (funder) {
        results[addr] = funder;
      }
    }
  }

  return results;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit(ip, 'funding-source', 30);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again in 1 minute.' },
      { status: 429, headers: getRateLimitHeaders(rl.remaining, 30) }
    );
  }

  try {
    const body: FundingBody = await req.json();
    const { wallets } = body;

    if (!wallets || !Array.isArray(wallets) || wallets.length === 0) {
      return NextResponse.json(
        { error: 'wallets array is required' },
        { status: 400 }
      );
    }

    const results = await withOverallTimeout(
      runFundingLookup(wallets),
      60_000,
      'Funding source lookup'
    );

    return NextResponse.json(results, {
      headers: getRateLimitHeaders(rl.remaining, 30),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
