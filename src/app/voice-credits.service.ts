import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from './firebase.client';

export interface VoiceCreditPolicy {
  enabled: boolean;
  admin: boolean;
  checkoutConfigured?: boolean;
  relayConfigured?: boolean;
  policy?: { monthlyMinutes: number; boardMinutes: number; changedAt: number; changedBy: string | null };
}
export interface VoiceCreditWallet {
  seconds: number;
  includedRemaining: number;
  hostedSeconds: number;
  resetAt: number;
  packMinutes: number;
  boards: { id: string; title: string; minutes: number; used: number }[];
}

@Injectable({ providedIn: 'root' })
export class VoiceCreditsService {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly status = signal<VoiceCreditPolicy | null>(null);
  private pending?: Promise<VoiceCreditPolicy>;

  refresh(): Promise<VoiceCreditPolicy> {
    if (!this.browser) return Promise.resolve({ enabled: false, admin: false });
    return this.pending ??= this.command<VoiceCreditPolicy>('status').then((result) => {
      this.status.set(result);
      return result;
    }).finally(() => { this.pending = undefined; });
  }

  async setPolicy(enabled: boolean, monthlyMinutes: number, boardMinutes: number, expectedChangedAt: number) {
    const result = await this.command<VoiceCreditPolicy>('set-policy', { enabled, monthlyMinutes, boardMinutes, expectedChangedAt });
    this.status.set(result);
  }

  quote(boardId: string, cardId: string, guest: string | null) {
    return this.command<{ seconds: number } | null>('quote', { boardId, cardId, guest });
  }

  wallet(teamId = '') {
    return this.command<VoiceCreditWallet>('wallet', { teamId });
  }

  setBoardCap(boardId: string, minutes: number, teamId = '') {
    return this.command('board-cap', { boardId, minutes, teamId });
  }

  async checkout(returnPath: string, teamId = '') {
    const { url } = await this.command<{ url: string }>('checkout', { origin: location.origin, returnPath, teamId });
    location.assign(url);
  }

  async confirmCheckout(url = new URL(location.href)): Promise<string> {
    const result = url.searchParams.get('voiceCheckout');
    const sessionId = url.searchParams.get('voiceSession');
    if (!result) return '';
    if (result === 'cancelled') {
      this.clearCheckout(url);
      return 'Checkout was cancelled.';
    }
    if (!sessionId) return '';
    const status = await this.command<{ paid: boolean; expired: boolean }>('confirm', { sessionId });
    if (status.paid || status.expired) this.clearCheckout(url);
    return status.paid ? 'Your voice credits are ready.' : status.expired
      ? 'This checkout expired.' : 'Payment is pending. Credits appear when payment is confirmed.';
  }

  private clearCheckout(url: URL): void {
    url.searchParams.delete('voiceCheckout');
    url.searchParams.delete('voiceSession');
    history.replaceState(history.state, '', url.href);
  }

  private async command<T = unknown>(action: string, data: Record<string, unknown> = {}): Promise<T> {
    if (!this.browser) throw new Error('Voice credits are available in the browser.');
    return (await httpsCallable<Record<string, unknown>, T>(getFirebaseFunctions(), 'voiceCreditsCommand', { timeout: action === 'status' ? 5_000 : 30_000 })({ action, ...data })).data;
  }
}

export function formatVoiceSeconds(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
