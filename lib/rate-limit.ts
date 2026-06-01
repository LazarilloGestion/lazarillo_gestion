const counts = new Map<string, { n: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = counts.get(key);
  if (!entry || entry.reset < now) {
    counts.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  if (entry.n >= limit) return false;
  entry.n++;
  return true;
}
