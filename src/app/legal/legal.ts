import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { TERMS_CONTENT } from './terms-content';
import { ThemeToggleComponent } from '../theme-toggle/theme-toggle';

type LegalSection = {
  heading: string;
  body: string[];
};

type LegalPageContent = {
  eyebrow: string;
  title: string;
  intro: string;
  updatedLabel: string;
  sections: LegalSection[];
};

const PRIVACY_CONTENT: LegalPageContent = {
  eyebrow: $localize`Privacy`,
  title: $localize`Privacy Policy`,
  intro:
    $localize`LivingWiki helps people upload documents, build atlas pages, and chat with knowledge derived from those materials. This page explains, in plain language, what information the product currently handles and why.`,
  updatedLabel: $localize`Last updated April 18, 2026`,
  sections: [
    {
      heading: $localize`What we collect`,
      body: [
        $localize`We collect account information such as name, email address, authentication details, and basic profile metadata needed to operate the workspace.`,
        $localize`We store the content you upload or submit, including files, URLs, extracted text, generated wiki content, chat threads, and source citations tied to your atlas.`,
        $localize`For public atlas pages, we also store public chat activity. Anonymous visitors are tracked with a browser-level anonymous identifier, and signed-in non-owners may have their name and email stored with the questions they ask.`,
      ],
    },
    {
      heading: $localize`How we use information`,
      body: [
        $localize`We use your information to authenticate users, process uploaded materials, generate wiki pages, answer chat questions, show citations, and maintain atlas history.`,
        $localize`We also use operational logs and product telemetry to debug failures, improve reliability, prevent abuse, and understand how the product is being used.`,
      ],
    },
    {
      heading: $localize`Public atlas behavior`,
      body: [
        $localize`If an atlas owner marks an atlas as public, visitors may be able to browse the atlas landing page, source files, wiki, and other public surfaces without signing in.`,
        $localize`Public chats are visible to the service operators and may later be visible to the relevant atlas owner inside the product. Owners should only publish atlases they are comfortable exposing in read-only form.`,
      ],
    },
    {
      heading: $localize`Sharing and service providers`,
      body: [
        $localize`We may use infrastructure, hosting, storage, authentication, analytics, and model providers to operate LivingWiki. Those providers may process data strictly to deliver the service on our behalf.`,
        $localize`We do not sell personal information. We may disclose information when required by law, to enforce our terms, or to protect the product, users, or the public.`,
      ],
    },
    {
      heading: $localize`Retention and security`,
      body: [
        $localize`We retain information for as long as it is needed to provide the service, maintain workspace history, comply with legal obligations, and resolve disputes.`,
        $localize`We use reasonable administrative, technical, and organizational safeguards, but no online system can guarantee absolute security.`,
      ],
    },
    {
      heading: $localize`Your choices`,
      body: [
        $localize`Atlas owners can remove documents and chats from their workspace where product controls allow it. Public visitors can stop using the service at any time.`,
        $localize`We may revise this policy as the product evolves. When we do, we will update the text on this page and change the effective date above.`,
      ],
    },
  ],
};

@Component({
  selector: 'app-legal',
  imports: [RouterLink, ThemeToggleComponent],
  styleUrl: './legal.css',
  templateUrl: './legal.html',
})
export class LegalComponent {
  private readonly route = inject(ActivatedRoute);

  private readonly routeData = toSignal(this.route.data, { initialValue: this.route.snapshot.data });

  readonly isTerms = computed(() => this.routeData()['legalPage'] !== 'privacy');
  readonly terms = TERMS_CONTENT;
  readonly page = computed<LegalPageContent>(() =>
    this.isTerms() ? TERMS_CONTENT : PRIVACY_CONTENT,
  );
}
