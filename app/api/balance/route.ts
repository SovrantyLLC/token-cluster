import { NextRequest, NextResponse } from 'next/server';
import { getTokenBalanceBatch } from '@/lib/avax';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { withOverallTimeout } from '@/lib/fetch-with-timeout';

interface BalanceBody {
  wallets: string[];
  tokenAddress: string;
  decimals: number;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit(ip, 'balance', 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again in 1 minute.' },
      { status: 429, headers: getRateLimitHeaders(rl.remaining, 60) }
    );
  }

  try {
    const body: BalanceBody = await req.json();
    const { wallets, tokenAddress, decimals } = body;

    if (!wallets || !tokenAddress || decimals === undefined) {
      return NextResponse.json(
        { error: 'wallets, tokenAddress, and decimals are required' },
        { status: 400 }
      );
    }

    const balances = await withOverallTimeout(
      getTokenBalanceBatch(wallets, tokenAddress, decimals),
      60_000,
      'Balance check'
    );
    return NextResponse.json({ balances }, {
      headers: getRateLimitHeaders(rl.remaining, 60),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
