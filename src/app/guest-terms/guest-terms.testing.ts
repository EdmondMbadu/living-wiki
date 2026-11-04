import { signal } from '@angular/core';

// Isolated storage: tests never accept terms for a real visitor/browser profile.
export class GuestTermsTestStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length(): number { return this.items.size; }
  clear(): void { this.items.clear(); }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  removeItem(key: string): void { this.items.delete(key); }
  setItem(key: string, value: string): void { this.items.set(key, value); }
}

export function guestTermsAuthStub() {
  return {
    initialized: signal(true),
    isAuthenticated: signal(false),
    waitForReady: async (): Promise<void> => undefined,
  };
}
