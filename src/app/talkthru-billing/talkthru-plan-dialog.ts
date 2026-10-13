import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../auth.service';
import {
  TalkThruBillingService,
  talkThruErrorMessage,
  talkThruSubscriptionLive,
  type TalkThruPromptReason,
} from './talkthru-billing.service';
import {
  TALKTHRU_PLAN_CATALOG,
  TALKTHRU_TEAM_MAX_SELF_SERVE_SEATS,
  TALKTHRU_TEAM_MIN_SEATS,
  TALKTHRU_TRIAL_DAYS,
  formatUsd,
  individualPlanCents,
  teamSeatTotalCents,
  type TalkThruBillingCycle,
  type TalkThruIndividualPlanKey,
} from './talkthru-plans';

interface PlanOption {
  key: TalkThruIndividualPlanKey;
  name: string;
  summary: string;
  features: string[];
  disabledReason: string;
}

@Component({
  selector: 'app-talkthru-plan-dialog',
  templateUrl: './talkthru-plan-dialog.html',
  styleUrl: './talkthru-plan-dialog.css',
})
export class TalkThruPlanDialogComponent {
  readonly billing = inject(TalkThruBillingService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly panel = viewChild<ElementRef<HTMLDialogElement>>('panel');

  readonly prompt = this.billing.dialog;
  readonly cycle = signal<TalkThruBillingCycle>('monthly');
  readonly selectedPlan = signal<TalkThruIndividualPlanKey>('solo');
  readonly seats = signal(TALKTHRU_TEAM_MIN_SEATS);
  readonly error = signal('');
  readonly maxSeats = TALKTHRU_TEAM_MAX_SELF_SERVE_SEATS;
  readonly trialDays = TALKTHRU_TRIAL_DAYS;

  readonly isTeam = computed(() => !!this.prompt()?.teamId);
  readonly personal = this.billing.personal;
  readonly team = computed(() => {
    const teamId = this.prompt()?.teamId;
    return teamId ? this.billing.teams()[teamId] ?? null : null;
  });
  readonly statusReady = computed(() => this.isTeam() ? !!this.team() : !!this.personal());
  readonly liveSubscription = computed(() => {
    const subscription = this.isTeam() ? this.team()?.subscription : this.personal()?.subscription;
    return talkThruSubscriptionLive(subscription) ? subscription! : null;
  });
  readonly trialEligible = computed(() => {
    if (this.liveSubscription()) return false;
    const status = this.isTeam() ? this.team() : this.personal();
    // Until the status arrives, describe the standard offer.
    return status ? status.trialEligible : true;
  });
  readonly occupiedSeats = computed(() => {
    const team = this.team();
    return team ? team.activeMembers + team.pendingInvites : 0;
  });
  readonly minSeats = computed(() => Math.max(TALKTHRU_TEAM_MIN_SEATS, this.occupiedSeats()));
  readonly tooManyAgents = computed(() => this.occupiedSeats() > TALKTHRU_TEAM_MAX_SELF_SERVE_SEATS);

  readonly headline = computed(() => this.copyFor(this.prompt()?.reason ?? 'choose').headline);
  readonly lede = computed(() => this.copyFor(this.prompt()?.reason ?? 'choose').lede);

  readonly planOptions = computed<PlanOption[]>(() => {
    const reason = this.prompt()?.reason;
    const current = this.personal();
    const soloDisabled = reason === 'video_export'
      ? $localize`Video export is not included`
      : current?.plan === 'solo' && reason === 'listing_limit'
        ? $localize`Your current plan`
        : '';
    return [
      {
        key: 'solo',
        name: $localize`Solo Agent`,
        summary: $localize`Put your voice on your next few listings.`,
        features: [
          $localize`Up to 10 live TalkThrus`,
          $localize`Your Personal Voice narration`,
          $localize`Share link and QR code`,
        ],
        disabledReason: soloDisabled,
      },
      {
        key: 'pro',
        name: $localize`Agent Pro`,
        summary: $localize`Every listing, every channel.`,
        features: [
          $localize`Unlimited live TalkThrus`,
          $localize`Video export for Reels, Instagram and YouTube`,
          $localize`Priority support`,
        ],
        disabledReason: '',
      },
    ];
  });

  readonly priceCents = computed(() => this.isTeam()
    ? teamSeatTotalCents(this.seats(), this.cycle())
    : individualPlanCents(this.selectedPlan(), this.cycle()));
  readonly priceLabel = computed(() => this.cycle() === 'annual'
    ? $localize`${formatUsd(this.priceCents())}:price:/yr`
    : $localize`${formatUsd(this.priceCents())}:price:/mo`);
  readonly cycleSuffix = computed(() => this.cycle() === 'annual' ? $localize`/yr` : $localize`/mo`);
  readonly seatsButtonLabel = computed(() => this.billing.redirecting() ? $localize`Opening Billing…` : $localize`Add seats in Billing`);
  readonly firstChargeDate = computed(() => {
    const date = new Date(Date.now() + TALKTHRU_TRIAL_DAYS * 86_400_000);
    return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  });
  readonly selectedName = computed(() => this.isTeam()
    ? $localize`Agency & Team`
    : this.selectedPlan() === 'pro' ? $localize`Agent Pro` : $localize`Solo Agent`);
  readonly primaryLabel = computed(() => {
    if (this.billing.redirecting()) return $localize`Opening secure checkout…`;
    if (this.liveSubscription()) return $localize`Switch to ${this.selectedName()}:plan:`;
    return this.trialEligible() ? $localize`Start my free month` : $localize`Continue to checkout`;
  });
  readonly canSubmit = computed(() => {
    if (this.billing.redirecting()) return false;
    if (this.isTeam()) {
      const team = this.team();
      return !!team && team.canManage && !this.tooManyAgents() && this.prompt()?.reason !== 'team_seats';
    }
    const option = this.planOptions().find((plan) => plan.key === this.selectedPlan());
    return !!option && !option.disabledReason;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      takeUntilDestroyed(destroyRef),
    ).subscribe(() => void this.billing.consumeCheckoutReturn());

    // Reset the form whenever a new prompt opens.
    effect(() => {
      const prompt = this.prompt();
      if (!prompt) return;
      untracked(() => {
        this.error.set('');
        this.cycle.set(prompt.preferredCycle ?? 'monthly');
        this.selectedPlan.set(this.billing.suggestedPlan(prompt.reason, this.personal()?.plan, prompt.preferredPlan));
        this.seats.set(this.minSeats());
      });
    });
    // A native modal dialog sits in the top layer, above any page dialog that
    // asked for a plan (team invite, board settings).
    effect(() => {
      const open = !!this.prompt();
      const dialog = this.panel()?.nativeElement;
      if (!dialog || typeof dialog.showModal !== 'function') return;
      if (open && !dialog.open) dialog.showModal();
      if (!open && dialog.open) dialog.close();
    });
    // Status can arrive after the dialog opens; keep the suggestion and seat floor valid.
    effect(() => {
      const prompt = this.prompt();
      const plan = this.personal()?.plan;
      const minimum = this.minSeats();
      if (!prompt) return;
      untracked(() => {
        if (!prompt.teamId) {
          const blocked = this.planOptions().find((option) => option.key === this.selectedPlan())?.disabledReason;
          if (blocked) this.selectedPlan.set(this.billing.suggestedPlan(prompt.reason, plan, prompt.preferredPlan));
        }
        if (this.seats() < minimum) this.seats.set(minimum);
      });
    });
    // Toasts clear themselves.
    effect((onCleanup) => {
      const notice = this.billing.notice();
      if (!notice) return;
      const timer = setTimeout(() => this.billing.notice.set(null), notice.kind === 'error' ? 12_000 : 8_000);
      onCleanup(() => clearTimeout(timer));
    });
  }

  planPrice(plan: TalkThruIndividualPlanKey): string {
    return formatUsd(individualPlanCents(plan, this.cycle()));
  }

  close(): void {
    if (this.billing.redirecting()) return;
    this.billing.closeDialog();
  }

  onBackdrop(event: MouseEvent): void {
    // The dialog element itself only receives clicks on its backdrop.
    if (event.target === event.currentTarget) this.close();
  }

  onCancel(event: Event): void {
    // Escape: close through the service so state and the element stay in step.
    event.preventDefault();
    this.close();
  }

  chooseSeats(value: number): void {
    const next = Math.round(Number(value));
    if (!Number.isFinite(next)) return;
    this.seats.set(Math.min(this.maxSeats, Math.max(this.minSeats(), next)));
  }

  async submit(): Promise<void> {
    const prompt = this.prompt();
    if (!prompt || !this.canSubmit()) return;
    this.error.set('');
    if (!this.auth.isAuthenticated()) {
      // New here: create the account, then land back on this choice.
      const redirectTo = prompt.teamId
        ? prompt.returnPath
        : `/talkthrus/billing?plan=${this.selectedPlan()}&cycle=${this.cycle()}`;
      this.billing.closeDialog();
      await this.router.navigate(['/create-account'], { queryParams: { redirectTo } });
      return;
    }
    try {
      await this.billing.startCheckout({
        plan: this.isTeam() ? 'team' : this.selectedPlan(),
        billingCycle: this.cycle(),
        returnPath: prompt.returnPath,
        ...(prompt.teamId ? { teamId: prompt.teamId, seats: this.seats() } : {}),
      });
    } catch (error) {
      this.error.set(talkThruErrorMessage(error, $localize`Checkout could not be started. Please try again.`));
    }
  }

  async manageBilling(): Promise<void> {
    const prompt = this.prompt();
    if (!prompt) return;
    this.error.set('');
    try {
      await this.billing.openPortal(prompt.returnPath, prompt.teamId ?? '');
    } catch (error) {
      this.error.set(talkThruErrorMessage(error, $localize`Billing could not be opened. Please try again.`));
    }
  }

  dismissNotice(): void {
    this.billing.notice.set(null);
  }

  private copyFor(reason: TalkThruPromptReason): { headline: string; lede: string } {
    switch (reason) {
      case 'listing_limit':
        return this.personal()?.plan === 'solo'
          ? {
              headline: $localize`You’ve reached ${TALKTHRU_PLAN_CATALOG.solo.activeLimit}:limit: live TalkThrus.`,
              lede: $localize`Agent Pro gives you unlimited listings, plus video export.`,
            }
          : {
              headline: $localize`Your free TalkThru is live.`,
              lede: $localize`Choose a plan to publish more listings. Your first month is free, and you can cancel anytime.`,
            };
      case 'video_export':
        return {
          headline: $localize`Video export comes with Agent Pro.`,
          lede: $localize`Turn every listing into a narrated video for Reels, Instagram and YouTube.`,
        };
      case 'team_listing_limit':
        return {
          headline: $localize`Your team’s free TalkThru is live.`,
          lede: $localize`Start the Agency & Team plan to publish every agent’s listings.`,
        };
      case 'team_seats':
        return {
          headline: $localize`Your team plan is full.`,
          lede: $localize`Add seats in Billing, then send the invitation again. New seats are prorated.`,
        };
      case 'team_choose':
        return {
          headline: $localize`Agency & Team plan`,
          lede: $localize`Agent Pro for every agent, with your agency’s branding alongside each agent’s voice.`,
        };
      default:
        return {
          headline: $localize`Choose your plan`,
          lede: $localize`Your first month is free. Cancel anytime.`,
        };
    }
  }
}
