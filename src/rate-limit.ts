/**
 * Sliding-window rate limiter (per-connection).
 *
 * We intentionally keep this simple and in-memory:
 * - Durable Objects isolate rooms; this limiter is per-room per-connection.
 * - On hibernation, in-memory state may reset; that's acceptable for rate limiting.
 */

export class RateLimiter {
  private timestamps: number[] = [];
  private readonly maxMessages: number;
  private readonly windowMs = 1000;

  constructor(maxMessagesPerSecond: number) {
    this.maxMessages = Math.max(1, Math.floor(maxMessagesPerSecond));
  }

  allow(now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift();
    }

    if (this.timestamps.length >= this.maxMessages) return false;
    this.timestamps.push(now);
    return true;
  }
}
