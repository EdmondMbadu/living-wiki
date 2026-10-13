import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { httpsCallable } from 'firebase/functions';
import { AuthService } from '../auth.service';
import { getFirebaseFunctions } from '../firebase.client';
import {
  planRank,
  type TalkThruBillingCycle,
  type TalkThruEffectivePlan,
  type TalkThruIndividualPlanKey,
  type TalkThruPlanKey,
} from './talkthru-plans';

export interface TalkThruSubscriptionView {
  plan: TalkThruPlanKey | null;
  billingCycle: TalkThruBillingCycle;
  status: string;
  seats: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
}

export interface TalkThruPersonalStatus {
  plan: TalkThruEffectivePlan;
  source: 'free' | 'admin' | 'comp' | 'personal' | 'team';
  teamId: string;
  activeLimit: number | null;
  activeCount: number;
  totalCount: number;
  pausedBoardIds: string[];
  videoExport: boolean;
  subscription: TalkThruSubscriptionView | null;
  canManageBilling: boolean;
  trialEligible: boolean;
}

export interface TalkThruTeamStatus {
  teamId: string;
  teamName: string;
  teamStatus: string;
  canManage: boolean;
  plan: 'free' | 'team';
  subscription: TalkThruSubscriptionView | null;
  activeMembers: number;
  pendingInvites: number;
  publishedCount: number;
  freePublishedLimit: number;
  canManageBilling: boolean;
  trialEligible: boolean;
}

export interface TalkThruStripeSetupReport {
  mode: 'test' | 'live';
  applied: boolean;
  ready: boolean;
  created: string[];
  problems: string[];
  portals: { personal: string; team: string };
  webhook: { status: 'ok' | 'updated' | 'missing' | 'needs_events'; endpointId: string; url: string; missingEvents: string[] };
}

export type TalkThruPromptReason =
  | 'choose'
  | 'listing_limit'
  | 'video_export'
  | 'team_listing_limit'
  | 'team_seats'
  | 'team_choose';

export interface TalkThruPlanPrompt {
  reason: TalkThruPromptReason;
  /** Where Stripe sends them back; the action that asked for the plan. */
  returnPath: string;
  teamId?: string;
  preferredPlan?: TalkThruIndividualPlanKey;
  preferredCycle?: TalkThruBillingCycle;
}

export interface TalkThruNotice {
  kind: 'success' | 'info' | 'error';
  message: string;
}

type CheckoutResponse =
  | { outcome: 'checkout'; url: string }
  | { outcome: 'changed' | 'unchanged' | 'included'; plan: TalkThruPlanKey; billingCycle: TalkThruBillingCycle };

const PLAN_INTENT_KEY = 'livingwiki.talkthru.planIntent';
const ACTIVE_STATUSES = new Set(['trialing', 'active', 'past_due']);

export function talkThruPlanRequiredDetails(error: unknown): { reason: string; teamId: string } | null {
  const details = (error as { details?: unknown } | null)?.details;
  if (!details || typeof details !== 'object') return null;
  const record = details as Record<string, unknown>;
  if (record['talkthruPlanRequired'] !== true) return null;
  return {
    reason: typeof record['reason'] === 'string' ? record['reason'] : 'choose',
    teamId: typeof record['teamId'] === 'string' ? record['teamId'] : '',
  };
}

export function talkThruErrorMessage(error: unknown, fallback = $localize`Something went wrong. Please try again.`): string {
  const message = error instanceof Error
    ? error.message.replace(/^Firebase:\s*/, '').replace(/\s*\(functions\/[^)]+\)\.?$/, '').trim()
    : '';
  return message && message !== 'INTERNAL' && message !== 'internal' ? message : fallback;
}

export function talkThruSubscriptionLive(subscription: TalkThruSubscriptionView | null | undefined): boolean {
  return !!subscription && ACTIVE_STATUSES.has(subscription.status);
}

/** Whole days left in a trial, rounded up so the last day still reads "1 day". */
export function talkThruDaysLeft(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const end = Date.parse(iso);
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - now) / 86_400_000));
}

@Injectable({ providedIn: 'root' })
export class TalkThruBillingService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly personal = signal<TalkThruPersonalStatus | null>(null);
  readonly teams = signal<Record<string, TalkThruTeamStatus>>({});
  readonly loading = signal(false);
  readonly dialog = signal<TalkThruPlanPrompt | null>(null);
  readonly notice = signal<TalkThruNotice | null>(null);
  readonly redirecting = signal(false);

  readonly videoExportEnabled = computed(() => this.personal()?.videoExport === true);

  private statusUid = '';
  private statusPromise: Promise<TalkThruPersonalStatus | null> | null = null;
  private statusAt = 0;
  private confirmation: Promise<void> | null = null;
  private handledReturnKey = '';

  constructor() {
    // Signing out or switching accounts never shows the previous account's plan.
    effect(() => {
      const uid = this.auth.uid();
      if (uid !== this.statusUid) {
        this.statusUid = uid;
        this.statusPromise = null;
        this.statusAt = 0;
        this.personal.set(null);
        this.teams.set({});
      }
    });
  }

  private async call<T>(data: Record<string, unknown>): Promise<T> {
    if (!this.browser) throw new Error($localize`Open this page in your browser to continue.`);
    const callable = httpsCallable<Record<string, unknown>, T>(getFirebaseFunctions(), 'talkThruBillingCommand', {
      timeout: data['action'] === 'status' ? 20_000 : 60_000,
    });
    return (await callable(data)).data;
  }

  /** Loads the signed-in account's plan. Cached briefly; a returning checkout is confirmed first. */
  async ensureStatus(force = false, teamId = ''): Promise<TalkThruPersonalStatus | null> {
    if (!this.browser) return null;
    await this.auth.waitForReady();
    if (!this.auth.uid()) return null;
    await this.consumeCheckoutReturn();
    if (!force && !teamId && this.statusPromise && Date.now() - this.statusAt < 60_000) return this.statusPromise;
    const uid = this.auth.uid();
    this.statusAt = Date.now();
    this.loading.set(true);
    const request = this.call<{ personal: TalkThruPersonalStatus; team: TalkThruTeamStatus | null }>({
      action: 'status',
      ...(teamId ? { teamId } : {}),
    }).then((response) => {
      if (this.auth.uid() !== uid) return null;
      this.personal.set(response.personal);
      if (response.team) this.teams.update((teams) => ({ ...teams, [response.team!.teamId]: response.team! }));
      return response.personal;
    }).catch((error) => {
      // Never block the person on a status failure: the server enforces every limit.
      console.warn('TalkThru plan status could not be loaded', error);
      this.statusPromise = null;
      return null;
    }).finally(() => this.loading.set(false));
    if (!teamId) this.statusPromise = request;
    return request;
  }

  async teamStatus(teamId: string, force = false): Promise<TalkThruTeamStatus | null> {
    if (!teamId) return null;
    if (!force && this.teams()[teamId]) return this.teams()[teamId];
    await this.ensureStatus(true, teamId);
    return this.teams()[teamId] ?? null;
  }

  /** True when a new personal TalkThru fits the plan (or the plan could not be read). */
  async canCreatePersonalTalkThru(fresh = false): Promise<boolean> {
    const status = await this.ensureStatus(fresh);
    if (!status || status.activeLimit === null) return true;
    return status.activeCount < status.activeLimit;
  }

  async canExportVideo(): Promise<boolean> {
    const status = await this.ensureStatus();
    return !status || status.videoExport;
  }

  /** Opens the plan picker. */
  prompt(request: TalkThruPlanPrompt): void {
    if (!this.browser) return;
    const preferredPlan = request.preferredPlan ?? this.planIntent() ?? undefined;
    this.dialog.set({ ...request, preferredPlan });
    if (request.teamId) void this.teamStatus(request.teamId, true);
    else void this.ensureStatus(true);
  }

  closeDialog(): void {
    this.dialog.set(null);
  }

  /** Turns a server "plan required" error into the plan picker. Returns true when handled. */
  handlePlanRequiredError(error: unknown, returnPath: string): boolean {
    const details = talkThruPlanRequiredDetails(error);
    if (!details) return false;
    const reason: TalkThruPromptReason = details.reason === 'team_listing_limit' || details.reason === 'team_seats'
      || details.reason === 'video_export' || details.reason === 'listing_limit'
      ? details.reason
      : 'choose';
    this.prompt({ reason, returnPath, ...(details.teamId ? { teamId: details.teamId } : {}) });
    return true;
  }

  async startCheckout(options: {
    plan: TalkThruPlanKey;
    billingCycle: TalkThruBillingCycle;
    returnPath: string;
    teamId?: string;
    seats?: number;
  }): Promise<void> {
    this.redirecting.set(true);
    try {
      const response = await this.call<CheckoutResponse>({ action: 'checkout', ...options });
      if (response.outcome === 'checkout') {
        this.forgetPlanIntent();
        window.location.assign(response.url);
        return;
      }
      this.redirecting.set(false);
      this.dialog.set(null);
      this.forgetPlanIntent();
      await (options.teamId ? this.teamStatus(options.teamId, true) : this.ensureStatus(true));
      if (options.teamId) await this.ensureStatus(true);
      this.notice.set({
        kind: 'success',
        message: response.outcome === 'changed'
          ? $localize`Your plan is updated. Any prorated difference appears on your next invoice.`
          : response.outcome === 'included'
            ? $localize`Your account already includes this plan. You’re all set.`
            : $localize`You’re already on this plan.`,
      });
    } catch (error) {
      this.redirecting.set(false);
      throw error;
    }
  }

  /** Platform admins: check (apply=false) or create/fix everything TalkThru needs in Stripe. */
  async stripeSetup(apply: boolean): Promise<TalkThruStripeSetupReport> {
    return this.call<TalkThruStripeSetupReport>({ action: 'setup', apply });
  }

  async openPortal(returnPath: string, teamId = ''): Promise<void> {
    this.redirecting.set(true);
    try {
      const response = await this.call<{ url: string }>({ action: 'portal', returnPath, ...(teamId ? { teamId } : {}) });
      window.location.assign(response.url);
    } catch (error) {
      this.redirecting.set(false);
      throw error;
    }
  }

  /**
   * Stripe returns to `…?talkthruCheckout=success&session_id=…`. Confirm the
   * session right away (the webhook may be seconds behind), then tidy the URL.
   */
  consumeCheckoutReturn(): Promise<void> {
    if (!this.browser) return Promise.resolve();
    if (this.confirmation) return this.confirmation;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('talkthruCheckout');
    if (!outcome) return Promise.resolve();
    const sessionId = params.get('session_id') ?? '';
    const returnKey = `${outcome}:${sessionId}`;
    this.confirmation = (async () => {
      try {
        if (returnKey === this.handledReturnKey) return;
        if (outcome === 'cancelled') {
          this.handledReturnKey = returnKey;
          this.notice.set({ kind: 'info', message: $localize`Checkout was cancelled. Nothing was charged.` });
          return;
        }
        if (outcome !== 'success' || !sessionId) return;
        await this.auth.waitForReady();
        // Signed out on return: keep the parameters so it confirms after sign-in.
        if (!this.auth.uid()) return;
        const result = await this.call<{ outcome: string; trialEndsAt: string | null; status?: string }>({
          action: 'confirm',
          sessionId,
        });
        this.handledReturnKey = returnKey;
        this.statusPromise = null;
        this.statusAt = 0;
        this.forgetPlanIntent();
        if (result.outcome === 'confirmed') {
          const trialEnds = result.trialEndsAt ? new Date(result.trialEndsAt) : null;
          this.notice.set({
            kind: 'success',
            message: trialEnds
              ? $localize`Your free month has started. You won’t be charged until ${trialEnds.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}:date:.`
              : $localize`Your plan is active. Thank you!`,
          });
        } else {
          this.notice.set({ kind: 'info', message: $localize`We’re finishing your checkout. Your plan will appear in a moment.` });
        }
      } catch (error) {
        this.handledReturnKey = returnKey;
        this.notice.set({
          kind: 'error',
          message: $localize`We couldn’t confirm your checkout yet. If you completed payment, your plan will appear shortly.`,
        });
        console.warn('TalkThru checkout confirmation failed', error);
      } finally {
        if (this.handledReturnKey === returnKey) await this.stripCheckoutParams();
        this.confirmation = null;
      }
    })();
    return this.confirmation;
  }

  private async stripCheckoutParams(): Promise<void> {
    const tree = this.router.parseUrl(this.router.url);
    if (!('talkthruCheckout' in tree.queryParams) && !('session_id' in tree.queryParams)) return;
    const { talkthruCheckout: _checkout, session_id: _session, ...queryParams } = tree.queryParams;
    tree.queryParams = queryParams;
    await this.router.navigateByUrl(tree, { replaceUrl: true });
  }

  rememberPlanIntent(plan: TalkThruIndividualPlanKey): void {
    if (!this.browser) return;
    try {
      window.localStorage.setItem(PLAN_INTENT_KEY, plan);
    } catch { /* Storage can be unavailable; the picker still works. */ }
  }

  planIntent(): TalkThruIndividualPlanKey | null {
    if (!this.browser) return null;
    try {
      const value = window.localStorage.getItem(PLAN_INTENT_KEY);
      return value === 'solo' || value === 'pro' ? value : null;
    } catch {
      return null;
    }
  }

  forgetPlanIntent(): void {
    if (!this.browser) return;
    try {
      window.localStorage.removeItem(PLAN_INTENT_KEY);
    } catch { /* ignore */ }
  }

  /** Personal plan the picker should suggest for a reason, given what they have now. */
  suggestedPlan(reason: TalkThruPromptReason, current: TalkThruEffectivePlan | undefined, preferred?: TalkThruIndividualPlanKey): TalkThruIndividualPlanKey {
    if (reason === 'video_export' || planRank(current) >= 1) return 'pro';
    return preferred ?? 'solo';
  }
}
