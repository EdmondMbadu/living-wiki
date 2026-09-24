import { Component, inject, signal } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from '../firebase.client';

const exampleUrl = 'https://www.livingwiki.com/share/board/00f3683f-229a-4fb6-8e28-2faf028ff1e0?v=2026-09-15T21%3A03%3A58.442Z&ui=en';

const previews = [
  { label: $localize`The property`, image: '/assets/talkthrus/property.png', alt: $localize`Beach Holiday Condo TalkThru listing example`, step: $localize`01 / SET THE SCENE`, heading: $localize`A home worth getting to know.`, body: $localize`Bring the listing together in a visual story that buyers can explore at their own pace.` },
  { label: $localize`The agent`, image: '/assets/talkthrus/agent.png', alt: $localize`Chip Watson personal welcome card`, step: $localize`02 / MAKE IT PERSONAL`, heading: $localize`Start with a familiar voice. Yours.`, body: $localize`Introduce yourself and welcome buyers into the property. Give them a person to connect with from the very beginning.` },
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
    message2: $localize`Sign up for TalkThrus`,
  };
  readonly exampleUrl = exampleUrl;
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
