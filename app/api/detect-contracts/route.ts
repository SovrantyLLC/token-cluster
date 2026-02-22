import { NextRequest, NextResponse } from 'next/server';
import { detectContracts } from '@/lib/avax';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { withOverallTimeout } from '@/lib/fetch-with-timeout';

interface DetectBody {
  addresses: string[];
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit(ip, 'detect-contracts', 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again in 1 minute.' },
      { status: 429, headers: getRateLimitHeaders(rl.remaining, 60) }
    );
  }

  try {
    const body: DetectBody = await req.json();
    const { addresses } = body;

    if (!addresses || !Array.isArray(addresses)) {
      return NextResponse.json({ error: 'addresses array is required' }, { status: 400 });
    }

    const contracts = await withOverallTimeout(
      detectContracts(addresses),
      60_000,
      'Contract detection'
    );
    return NextResponse.json({ contracts }, {
      headers: getRateLimitHeaders(rl.remaining, 60),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
