export class KeyedExecutor {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly waiters: Array<() => void> = [];
  private active = 0;
  private accepting = true;

  constructor(private readonly maxConcurrentKeys = 4) {
    if (!Number.isSafeInteger(maxConcurrentKeys) || maxConcurrentKeys < 1) throw new Error("maxConcurrentKeys must be a positive integer");
  }

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (!this.accepting) throw new Error("executor is shutting down");
    const previous = this.tails.get(key) ?? Promise.resolve();
    let releaseTail!: () => void;
    const tail = new Promise<void>((resolve) => {
      releaseTail = resolve;
    });
    this.tails.set(key, tail);

    await previous;
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
      releaseTail();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  async shutdown(deadlineMs: number): Promise<boolean> {
    this.accepting = false;
    const deadline = Date.now() + Math.max(0, deadlineMs);
    while ((this.active > 0 || this.tails.size > 0) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return this.active === 0 && this.tails.size === 0;
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrentKeys) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    this.waiters.shift()?.();
  }
}
