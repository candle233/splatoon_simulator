export class RateLimiter {
  private maxTokens: number;
  private refillRate: number; // tokens per second
  private tokens: Map<string, { count: number; lastRefill: number }> = new Map();

  constructor(maxTokens = 60, refillRate = 40) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
  }

  consume(key: string, tokens = 1): boolean {
    const now = performance.now() / 1000;
    let entry = this.tokens.get(key);

    if (!entry) {
      entry = { count: this.maxTokens, lastRefill: now };
      this.tokens.set(key, entry);
    }

    const elapsed = now - entry.lastRefill;
    entry.count = Math.min(this.maxTokens, entry.count + elapsed * this.refillRate);
    entry.lastRefill = now;

    if (entry.count >= tokens) {
      entry.count -= tokens;
      return true;
    }

    return false;
  }

  remove(key: string): void {
    this.tokens.delete(key);
  }
}
