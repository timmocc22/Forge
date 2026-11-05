/** Shared admission for text decisions, summaries and artifact model calls. */
export class ModelInvocationLimiter {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly limit: number) {}
  async run<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener('abort', abort);
        this.active++;
        resolve();
      };
      const abort = () => {
        this.queue = this.queue.filter((item) => item !== start);
        reject(signal.reason);
      };
      if (this.active < this.limit) start();
      else {
        this.queue.push(start);
        signal.addEventListener('abort', abort, { once: true });
      }
    });
    try {
      signal.throwIfAborted();
      return await action();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
