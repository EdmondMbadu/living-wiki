import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { FormsModule, NgForm } from '@angular/forms';
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

export type TalkThruRequestType = 'free' | 'done_for_you' | 'founding' | 'waitlist' | 'general';

const previews = [
  { label: $localize`The property`, step: $localize`01 / SET THE SCENE`, heading: $localize`A home worth getting to know.`, body: $localize`Their listing photos, arranged into a natural walk through the home that sellers and buyers explore at their own pace.` },
  { label: $localize`The agent`, step: $localize`02 / PUT YOU IN THE ROOM`, heading: $localize`Your name on every room.`, body: $localize`Your headshot, contact card and branding travel with the story — so every replay, share and forward leads back to you.` },
  { label: $localize`The narration`, step: $localize`03 / TELL IT LIKE YOU WOULD`, heading: $localize`The details only you know.`, body: $localize`In first person, in your own voice — and in Spanish or 30+ other languages when their buyers need it.` },
] as const;

const bonuses = [
  { title: $localize`The Listing Appointment Closer`, description: $localize`Pitch slide + talk track built around their TalkThru.`, value: '$99' },
  { title: $localize`The Seller Story Page`, description: $localize`A private page they replay and share with family.`, value: '$79' },
  { title: $localize`Multilingual Pack`, description: $localize`Spanish and 30+ languages, still in your voice.`, value: '$99' },
  { title: $localize`The Open House Magnet`, description: $localize`QR yard-sign riders and flyers — buyers hear you from the curb.`, value: '$49' },
  { title: $localize`Just Listed / Just Sold Social Kit`, description: $localize`Ready-to-post templates from every TalkThru.`, value: '$39' },
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
  readonly videoError = signal(false);
  readonly videoStarted = signal(false);
  readonly previewLanguage = signal<'en' | 'es'>('en');
  readonly foundingCities = ['Miami', 'Austin', 'Charlotte'];
  readonly bonuses = bonuses;
  requestType: TalkThruRequestType = 'free';
  city = '';

  @ViewChild('introductionVideo')
  set introductionVideo(ref: ElementRef<HTMLVideoElement> | undefined) {
    // The video is created only after an explicit play action. Native controls
    // remain available if the browser declines the initial playback request.
    if (ref) void ref.nativeElement.play().catch(() => {});
  }

  @ViewChild('thankYou')
  set thankYou(ref: ElementRef<HTMLElement> | undefined) {
    ref?.nativeElement.focus();
  }

  playIntroduction(): void {
    this.videoError.set(false);
    this.videoStarted.set(true);
  }

  selectRequest(type: TalkThruRequestType, agency = false, city = ''): void {
    this.requestType = type;
    this.role = agency ? 'agency' : 'agent';
    this.city = city;
    this.submitted.set(false);
    this.error.set('');
    this.submissionId = null;
  }

  onPreviewKey(event: KeyboardEvent, index: number): void {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? this.previews.length - 1
      : event.key === 'ArrowRight' ? (index + 1) % this.previews.length
      : event.key === 'ArrowLeft' ? (index + this.previews.length - 1) % this.previews.length : null;
    if (next === null) return;
    event.preventDefault();
    this.selectedPreview.set(next);
    const tabs = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]');
    tabs?.[next]?.focus();
  }
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
    inject(Meta).updateTag({ name: 'description', content: $localize`Win your next listing with a TalkThru in your own voice. Get a free listing story, or let us build it for you with our 48-hour promise.` });
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
    } catch (error) {
      this.ctaError.set(talkThruErrorMessage(error, $localize`Your TalkThru could not be started. Please try again.`));
    } finally {
      this.ctaBusy.set('');
    }
  }

  async startTeam(): Promise<void> {
    if (this.ctaBusy()) return;
    this.ctaError.set('');
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
    } catch (error) {
      this.ctaError.set(talkThruErrorMessage(error, $localize`Your team could not be opened. Please try again.`));
    } finally {
      this.ctaBusy.set('');
    }
  }

  async submit(form: NgForm): Promise<void> {
    if (this.sending() || form.invalid) return;
    this.error.set('');
    this.sending.set(true);
    try {
      this.submissionId ??= globalThis.crypto?.randomUUID?.() ?? null;
      await this.sendInterest({
        submissionId: this.submissionId,
        role: this.role,
        name: this.name.trim(),
        email: this.email.trim(),
        agency: this.agency.trim(),
        listing: this.listing.trim(),
        website: this.website,
        consent: this.consent,
        requestType: this.requestType,
        city: this.requestType === 'founding' || this.requestType === 'waitlist' ? this.city.trim() : '',
      });
      this.submitted.set(true);
    } catch {
      this.error.set($localize`We couldn’t send your request. Please try again.`);
    } finally {
      this.sending.set(false);
    }
  }

  protected async sendInterest(input: Record<string, unknown>): Promise<void> {
    await httpsCallable(getFirebaseFunctions(), 'submitTalkThruInterest')(input);
  }
}
