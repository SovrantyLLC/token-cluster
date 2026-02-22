import { NextRequest, NextResponse } from 'next/server';
import { lookupToken } from '@/lib/avax';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { withOverallTimeout } from '@/lib/fetch-with-timeout';

interface LookupBody {
  address: string;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit(ip, 'token-lookup', 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again in 1 minute.' },
      { status: 429, headers: getRateLimitHeaders(rl.remaining, 60) }
    );
  }

  try {
    const body: LookupBody = await req.json();
    const { address } = body;

    if (!address) {
      return NextResponse.json({ error: 'address is required' }, { status: 400 });
    }

    const token = await withOverallTimeout(
      lookupToken(address),
      60_000,
      'Token lookup'
    );
    if (!token) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 });
    }

    return NextResponse.json(token, {
      headers: getRateLimitHeaders(rl.remaining, 60),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
