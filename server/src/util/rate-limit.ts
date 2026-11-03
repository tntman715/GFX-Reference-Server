/** 고정 윈도우 방식의 간단한 메모리 rate limiter */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** 허용되면 true */
  take(key: string): boolean {
    const now = Date.now();
    const cur = this.hits.get(key);
    if (!cur || cur.reset < now) {
      if (this.hits.size > 10_000) {
        for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
      }
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      return true;
    }
    if (cur.count >= this.limit) return false;
    cur.count++;
    return true;
  }
}
