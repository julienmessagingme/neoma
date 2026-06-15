/**
 * In-memory rate limiter for the login endpoint, to blunt online password
 * brute-force. Distinct from the redirect limiter (`lib/redirect/rate-limit`)
 * which is tuned for high-volume `/r/` traffic (100/min) — login needs to be
 * much stricter.
 *
 * Keyed independently by IP and by email so neither a single IP spraying many
 * accounts nor a single targeted account can be hammered. Per-process (each
 * container has its own map); combined with bcrypt (~100 ms/attempt) this is
 * enough defense-in-depth for an invite-only dashboard. For multi-instance or
 * stronger guarantees, move this to Redis.
 */
const WINDOW_MS = 10 * 60_000; // 10 min

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Records an attempt for `key` and returns `true` if it is allowed, `false`
 * if `key` has already reached `max` attempts in the current window.
 */
export function checkLoginRate(key: string, max: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}

// Recommended limits per window (caller picks): generous per-IP (tolerates a
// shared NAT / office), strict per-email (protects a targeted account).
export const LOGIN_MAX_PER_IP = 50;
export const LOGIN_MAX_PER_EMAIL = 10;

// Periodic cleanup to prevent unbounded growth.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.windowStart > WINDOW_MS) buckets.delete(k);
  }
}, WINDOW_MS).unref?.();
