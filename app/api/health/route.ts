import { NextResponse } from 'next/server';
import { AVAX_RPC, ROUTESCAN_API } from '@/lib/constants';

export const dynamic = 'force-dynamic';

async function checkEndpoint(url: string, timeoutMs: number = 5000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

export async function GET() {
  const [rpcOk, apiOk] = await Promise.all([
    checkEndpoint(AVAX_RPC, 5000).catch(() => false),
    checkEndpoint(
      `${ROUTESCAN_API}?module=stats&action=ethprice`,
      5000
    ).catch(() => false),
  ]);

  const status = rpcOk && apiOk ? 'ok' : 'degraded';

  return NextResponse.json(
    { status, rpc: rpcOk, api: apiOk, timestamp: Date.now() },
    { status: rpcOk && apiOk ? 200 : 503 }
  );
}
