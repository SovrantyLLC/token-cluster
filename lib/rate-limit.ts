const windowMs = 60 * 1000; // 1 minute

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 2 minutes
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 120_000) return;
  lastCleanup = now;
  const keys = Array.from(store.keys());
  for (let i = 0; i < keys.length; i++) {
    const entry = store.get(keys[i]);
    if (entry && entry.resetAt < now) {
      store.delete(keys[i]);
    }
  }
}

export function rateLimit(
  ip: string,
  route: string,
  maxRequests: number
): { allowed: boolean; remaining: number } {
  cleanup();

  const now = Date.now();
  const key = `${ip}:${route}`;
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  entry.count++;
  if (entry.count > maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: maxRequests - entry.count };
}

export function getRateLimitHeaders(
  remaining: number,
  limit: number
): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
  };
}
