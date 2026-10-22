type Entry = { key: string; priority: number; run: () => Promise<void>; current: () => boolean;
  resolve: () => void; reject: (error: unknown) => void; promise: Promise<void> };

/** Two provider requests at most; newest visible work goes before speculative work. */
export class LiveTranslationQueue {
  private active = 0;
  private sequence = 0;
  private entries = new Map<string, Entry>();
  private pending: Entry[] = [];
  constructor(private readonly concurrency = 2) {}

  schedule(key: string, run: () => Promise<void>, current: () => boolean, foreground: boolean): Promise<void> {
    const priority = foreground ? ++this.sequence : -1;
    const existing = this.entries.get(key);
    if (existing) { existing.priority = Math.max(existing.priority, priority); return existing.promise; }
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const entry = { key, run, current, priority, promise, resolve, reject };
    this.entries.set(key, entry);
    this.pending.push(entry);
    this.pump();
    return promise;
  }

  private pump(): void {
    this.pending.sort((a, b) => b.priority - a.priority);
    while (this.active < this.concurrency && this.pending.length) {
      const entry = this.pending.shift()!;
      if (!entry.current()) {
        this.entries.delete(entry.key);
        entry.resolve();
        continue;
      }
      this.active++;
      void entry.run().then(entry.resolve, entry.reject).finally(() => {
        this.active--;
        this.entries.delete(entry.key);
        this.pump();
      });
    }
  }
}
