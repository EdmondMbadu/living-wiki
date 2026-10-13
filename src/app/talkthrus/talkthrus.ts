import { Component, computed, inject, signal } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { httpsCallable } from 'firebase/functions';
import { AuthService } from '../auth.service';
import { getFirebaseFunctions } from '../firebase.client';
import { TalkThruBillingService } from '../talkthru-billing/talkthru-billing.service';
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

  /** Start free: build the first TalkThru with no card. Remembers the plan they looked at. */
  async startIndividual(plan: TalkThruIndividualPlanKey): Promise<void> {
    if (this.ctaBusy()) return;
    this.ctaBusy.set(plan);
    try {
      this.billing.rememberPlanIntent(plan);
      await this.auth.waitForReady();
      if (!this.auth.isAuthenticated()) {
        await this.router.navigate(['/create-account'], { queryParams: { redirectTo: createListingPath } });
        return;
      }
      const status = await this.billing.ensureStatus(true);
      const atLimit = !!status && status.activeLimit !== null && status.activeCount >= status.activeLimit;
      if (atLimit) {
        this.billing.prompt({ reason: 'choose', returnPath: createListingPath, preferredPlan: plan, preferredCycle: this.cycle() });
        return;
      }
      await this.router.navigate(['/boards'], { queryParams: { create: 'real-estate' } });
    } finally {
      this.ctaBusy.set('');
    }
  }

  /** Skip the free listing and start the free month now. */
  async startFreeMonth(plan: TalkThruIndividualPlanKey): Promise<void> {
    this.billing.rememberPlanIntent(plan);
    await this.auth.waitForReady();
    if (!this.auth.isAuthenticated()) {
      await this.router.navigate(['/create-account'], {
        queryParams: { redirectTo: `/talkthrus/billing?plan=${plan}&cycle=${this.cycle()}` },
      });
      return;
    }
    this.billing.prompt({ reason: 'choose', returnPath: '/talkthrus/billing', preferredPlan: plan, preferredCycle: this.cycle() });
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
