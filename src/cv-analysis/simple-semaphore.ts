/**
 * Minimal FIFO counting semaphore — bounds how many callers run a critical
 * section concurrently (here: Gemini extractions sharing one key pool).
 * No external dependency; single-process only (each instance has its own
 * counter — cross-instance protection comes from DB-level guards).
 */
export class SimpleSemaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.available = Math.max(1, Math.floor(limit));
  }

  /**
   * Wait for a free slot. Resolves with a release function that MUST be
   * called exactly once (typically in a `finally`); extra calls are no-ops.
   */
  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
    } else {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
      // Slot was handed over directly by release() — counter already accounts
      // for us, so no decrement here.
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.available++;
    };
  }
}
