import { Component, computed, inject, signal } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { httpsCallable } from 'firebase/functions';
import { AuthService } from '../auth.service';
import { getFirebaseFunctions } from '../firebase.client';
import { TalkThruBillingService, talkThruErrorMessage } from '../talkthru-billing/talkthru-billing.service';
import {
  formatUsd,
  individualPlanCents,
  TALKTHRU_PLAN_CATALOG,
  type TalkThruBillingCycle,
  type TalkThruIndividualPlanKey,
} from '../talkthru-billing/talkthru-plans';
import { TeamsService } from '../teams/teams.service';

const createListingPath = '/boards?create=real-estate';

const exampleUrl = 'https://www.livingwiki.com/boards/charming-beach-condo-wildwood-nj';

const previews = [
  { label: $localize`The property`, image: '/assets/talkthrus/property.png', alt: $localize`Beach Holiday Condo TalkThru listing example`, step: $localize`01 / SET THE SCENE`, heading: $localize`A home worth getting to know.`, body: $localize`Bring the listing together in a visual story that buyers can explore at their own pace.` },
  { label: $localize`The agent`, image: '/assets/talkthrus/jennifer-jones-card.png', alt: $localize`Jennifer Jones personal welcome card for a Wildwood condominium`, step: $localize`02 / MAKE IT PERSONAL`, heading: $localize`Start with a familiar voice. Yours.`, body: $localize`Introduce yourself and welcome buyers into the property. Give them a person to connect with from the very beginning.` },
  { label: $localize`The narration`, image: '/assets/talkthrus/voice.png', alt: $localize`TalkThru narration settings with style and length choices`, step: $localize`03 / TELL ITS STORY`, heading: $localize`Add the details only you can.`, body: $localize`Shape the narration around your insights, from the way a room feels to the features that deserve a closer look.` },
] as const;

@Component({
  selector: 'app-talkthrus',
  imports: [FormsModule],
  templateUrl: './talkthrus.html',
  styleUrl: './talkthrus.css',
})
export class TalkThrusComponent {
  readonly templateText = {
    message1: $localize`Sending…`,
    message2: $localize`Send my details`,
  };
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly billing = inject(TalkThruBillingService);
  private readonly teams = inject(TeamsService);
  readonly exampleUrl = exampleUrl;
  readonly cycle = signal<TalkThruBillingCycle>('monthly');
  readonly ctaBusy = signal('');
  readonly ctaError = signal('');
  readonly teamTiers = computed(() => {
    const [first, second] = TALKTHRU_PLAN_CATALOG.team.tiers[this.cycle()];
    return { first: formatUsd(first.unitCents), second: formatUsd(second.unitCents) };
  });
  readonly cycleSuffix = computed(() => this.cycle() === 'annual' ? $localize`/yr` : $localize`/mo`);
  readonly teamSuffix = computed(() => this.cycle() === 'annual' ? $localize`/agent/yr` : $localize`/agent/mo`);
  readonly previews = previews;
  readonly selectedPreview = signal(0);
  readonly sending = signal(false);
  readonly submitted = signal(false);
  readonly error = signal('');
  role: 'agent' | 'agency' = 'agent';
  name = '';
  email = '';
  agency = '';
  listing = '';
  website = '';
  consent = false;
  private submissionId: string | null = null;

  constructor() {
    inject(Meta).updateTag({ name: 'description', content: $localize`Turn real estate listing photos into a personal, narrated TalkThru. Your voice, your insights, and a more human connection with buyers.` });
  }

  planPrice(plan: TalkThruIndividualPlanKey): string {
    return formatUsd(individualPlanCents(plan, this.cycle()));
  }

  /**
   * Paid plans go straight to Stripe Checkout: card on file, first month free.
   * Stripe returns to the listing wizard, so they build their first TalkThru next.
   */
  async subscribe(plan: TalkThruIndividualPlanKey): Promise<void> {
    if (this.ctaBusy()) return;
    this.ctaError.set('');
    this.ctaBusy.set(plan);
    try {
      this.billing.rememberPlanIntent(plan);
      await this.auth.waitForReady();
      if (!this.auth.isAuthenticated()) {
        await this.router.navigate(['/create-account'], {
          queryParams: { redirectTo: `/talkthrus/billing?checkout=${plan}&cycle=${this.cycle()}` },
        });
        return;
      }
      // Redirects to Stripe; for someone already on a plan it switches in place.
      await this.billing.startCheckout({ plan, billingCycle: this.cycle(), returnPath: createListingPath });
      if (!this.billing.redirecting()) await this.router.navigateByUrl(createListingPath);
    } catch (error) {
      this.ctaError.set(talkThruErrorMessage(error, $localize`Checkout could not be started. Please try again.`));
    } finally {
      if (!this.billing.redirecting()) this.ctaBusy.set('');
    }
  }

  /** The free path: one TalkThru, no card. At the limit it offers the plans instead. */
  async tryFree(): Promise<void> {
    if (this.ctaBusy()) return;
    this.ctaError.set('');
    this.ctaBusy.set('free');
    try {
      await this.auth.waitForReady();
      if (!this.auth.isAuthenticated()) {
        await this.router.navigate(['/create-account'], { queryParams: { redirectTo: createListingPath } });
        return;
      }
      const status = await this.billing.ensureStatus(true);
      if (status && status.activeLimit !== null && status.activeCount >= status.activeLimit) {
        this.billing.prompt({ reason: 'listing_limit', returnPath: createListingPath, preferredCycle: this.cycle() });
        return;
      }
      await this.router.navigateByUrl(createListingPath);
    } finally {
      this.ctaBusy.set('');
    }
  }

  async startTeam(): Promise<void> {
    if (this.ctaBusy()) return;
    this.ctaBusy.set('team');
    try {
      await this.auth.waitForReady();
      if (!this.auth.isAuthenticated()) {
        await this.router.navigate(['/create-account'], { queryParams: { redirectTo: '/teams/new' } });
        return;
      }
      const adminTeam = this.teams.activeMemberships().find((team) => team.role === 'admin');
      if (adminTeam) {
        await this.router.navigate(['/teams', adminTeam.teamId], { queryParams: { plan: 'team', cycle: this.cycle() } });
        return;
      }
      await this.router.navigateByUrl(this.teams.memberships().length ? '/teams' : '/teams/new');
    } finally {
      this.ctaBusy.set('');
    }
  }

  async submit(): Promise<void> {
    if (this.sending()) return;
    this.error.set('');
    this.sending.set(true);
    try {
      this.submissionId ??= globalThis.crypto?.randomUUID?.() ?? null;
      const submitInterest = httpsCallable(getFirebaseFunctions(), 'submitTalkThruInterest');
      await submitInterest({
        submissionId: this.submissionId,
        role: this.role,
        name: this.name.trim(),
        email: this.email.trim(),
        agency: this.agency.trim(),
        listing: this.listing.trim(),
        website: this.website,
        consent: this.consent,
      });
      this.submitted.set(true);
    } catch {
      this.error.set($localize`We couldn’t send your request. Please try again.`);
    } finally {
      this.sending.set(false);
    }
  }
}
