import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';
import { TeamsService } from '../teams/teams.service';
import {
  type TalkThruStripeSetupReport,
  TalkThruBillingService,
  talkThruDaysLeft,
  talkThruErrorMessage,
  talkThruSubscriptionLive,
} from './talkthru-billing.service';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

@Component({
  selector: 'app-talkthru-billing-page',
  imports: [RouterLink],
  templateUrl: './talkthru-billing-page.html',
  styleUrl: './talkthru-billing-page.css',
})
export class TalkThruBillingPageComponent implements OnInit {
  readonly billing = inject(TalkThruBillingService);
  readonly teams = inject(TeamsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly isAdmin = inject(AuthService).isAdmin;
  readonly setupReport = signal<TalkThruStripeSetupReport | null>(null);
  readonly setupBusy = signal(false);
  readonly setupError = signal('');
  readonly openingCheckout = $localize`Opening secure checkout…`;
  readonly status = this.billing.personal;
  readonly loaded = signal(false);
  readonly error = signal('');

  readonly subscription = computed(() => this.status()?.subscription ?? null);
  readonly live = computed(() => talkThruSubscriptionLive(this.subscription()));
  readonly planName = computed(() => {
    const status = this.status();
    if (!status) return '';
    if (status.source === 'admin') return $localize`Agent Pro · admin access`;
    if (status.source === 'team') return $localize`Agent Pro · included with your team plan`;
    if (status.source === 'comp') return status.plan === 'pro' ? $localize`Agent Pro · complimentary` : $localize`Solo Agent · complimentary`;
    if (status.plan === 'pro') return $localize`Agent Pro`;
    if (status.plan === 'solo') return $localize`Solo Agent`;
    return $localize`Free`;
  });
  readonly statusLine = computed(() => {
    const subscription = this.subscription();
    const status = this.status();
    if (!status) return '';
    if (!subscription || !this.live() || status.source !== 'personal') {
      return status.plan === 'free'
        ? $localize`Your first TalkThru is free, with no card required.`
        : '';
    }
    const cycle = subscription.billingCycle === 'annual' ? $localize`billed annually` : $localize`billed monthly`;
    if (subscription.status === 'past_due') {
      return $localize`We couldn’t charge your card. Update it in Billing to keep your plan.`;
    }
    if (subscription.status === 'trialing') {
      const days = talkThruDaysLeft(subscription.trialEndsAt) ?? 0;
      const end = formatDate(subscription.trialEndsAt);
      return subscription.cancelAtPeriodEnd
        ? $localize`Free month · ${days}:days: days left · ends ${end}:date: and won’t renew`
        : $localize`Free month · ${days}:days: days left · first charge on ${end}:date: (${cycle}:cycle:)`;
    }
    const periodEnd = formatDate(subscription.cancelAt || subscription.currentPeriodEnd);
    return subscription.cancelAtPeriodEnd
      ? $localize`Cancelled · access until ${periodEnd}:date:`
      : $localize`Renews ${periodEnd}:date: · ${cycle}:cycle:`;
  });
  readonly usageLine = computed(() => {
    const status = this.status();
    if (!status) return '';
    return status.activeLimit === null
      ? $localize`${status.activeCount}:count: live · unlimited`
      : $localize`${status.activeCount}:count: of ${status.activeLimit}:limit: live`;
  });
  readonly canCreate = computed(() => {
    const status = this.status();
    return !!status && (status.activeLimit === null || status.activeCount < status.activeLimit);
  });
  readonly primaryAction = computed<'start' | 'upgrade' | null>(() => {
    const status = this.status();
    if (!status) return null;
    if (status.plan === 'free') return 'start';
    if (status.plan === 'solo') return 'upgrade';
    return null;
  });

  async ngOnInit(): Promise<void> {
    await this.load(true);
    const params = this.route.snapshot.queryParamMap;
    const plan = params.get('plan');
    const cycle = params.get('cycle');
    const checkout = params.get('checkout');
    if (checkout === 'solo' || checkout === 'pro') {
      // They chose a paid plan before creating their account: continue to Stripe.
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { checkout: null, cycle: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      try {
        await this.billing.startCheckout({
          plan: checkout,
          billingCycle: cycle === 'annual' ? 'annual' : 'monthly',
          returnPath: '/boards?create=real-estate',
        });
        if (!this.billing.redirecting()) await this.router.navigateByUrl('/boards?create=real-estate');
      } catch (error) {
        this.error.set(talkThruErrorMessage(error, $localize`Checkout could not be started. Please try again.`));
      }
      return;
    }
    if (plan === 'solo' || plan === 'pro') {
      this.billing.prompt({
        reason: 'choose',
        returnPath: '/talkthrus/billing',
        preferredPlan: plan,
        preferredCycle: cycle === 'annual' ? 'annual' : 'monthly',
      });
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { plan: null, cycle: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  async load(force = false): Promise<void> {
    this.error.set('');
    const status = await this.billing.ensureStatus(force);
    if (!status) this.error.set($localize`Your plan couldn’t be loaded. Check your connection and try again.`);
    this.loaded.set(true);
  }

  choosePlan(): void {
    this.billing.prompt({
      reason: 'choose',
      returnPath: '/talkthrus/billing',
      preferredPlan: this.status()?.plan === 'solo' ? 'pro' : undefined,
    });
  }

  async manageBilling(): Promise<void> {
    this.error.set('');
    try {
      await this.billing.openPortal('/talkthrus/billing');
    } catch (error) {
      this.error.set(talkThruErrorMessage(error, $localize`Billing could not be opened. Please try again.`));
    }
  }

  async runStripeSetup(apply: boolean): Promise<void> {
    if (this.setupBusy()) return;
    if (apply && !window.confirm('Create or update the TalkThru products, prices, billing portals and webhook events in Stripe?')) return;
    this.setupBusy.set(true);
    this.setupError.set('');
    try {
      this.setupReport.set(await this.billing.stripeSetup(apply));
    } catch (error) {
      this.setupError.set(talkThruErrorMessage(error, 'Stripe could not be checked. Please try again.'));
    } finally {
      this.setupBusy.set(false);
    }
  }

  createTalkThru(): void {
    if (this.canCreate()) {
      void this.router.navigate(['/boards'], { queryParams: { create: 'real-estate' } });
      return;
    }
    this.billing.prompt({ reason: 'listing_limit', returnPath: '/boards?create=real-estate' });
  }
}
