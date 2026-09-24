import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
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

const TERMS_CONTENT: LegalPageContent = {
  eyebrow: $localize`Terms`,
  title: $localize`Terms and Conditions`,
  intro:
    $localize`These terms are a practical starting point for using LivingWiki. They are intentionally concise for now and will be refined as the product matures.`,
  updatedLabel: $localize`Last updated April 18, 2026`,
  sections: [
    {
      heading: $localize`Product ownership`,
      body: [
        $localize`LivingWiki™ is a product of Mind Palace Inc.`,
        $localize`LivingWiki is an independent product of Mind Palace Inc. and is not affiliated with, endorsed by, or sponsored by the Wikimedia Foundation, Wikipedia, or any related Wikimedia project.`,
      ],
    },
    {
      heading: $localize`Using the service`,
      body: [
        $localize`By accessing or using LivingWiki, you agree to use the product lawfully and responsibly. If you do not agree, do not use the service.`,
        $localize`You are responsible for your account, your atlas settings, and the activity that occurs under your credentials.`,
      ],
    },
    {
      heading: $localize`Your content`,
      body: [
        $localize`You keep ownership of the content you upload or submit. You give LivingWiki permission to host, process, transform, index, and display that content as needed to operate the product.`,
        $localize`You are responsible for making sure you have the rights to upload, publish, and share the material you place into the service.`,
      ],
    },
    {
      heading: $localize`Public atlases and chats`,
      body: [
        $localize`If you make an atlas public, you are responsible for the materials and generated content exposed through that atlas.`,
        $localize`Public visitors may be allowed to ask questions against a public atlas. Those interactions may be logged and associated with anonymous identifiers or signed-in visitor account details.`,
      ],
    },
    {
      heading: $localize`Acceptable use`,
      body: [
        $localize`You may not use LivingWiki to violate the law, infringe intellectual property or privacy rights, distribute harmful material, interfere with the service, or attempt unauthorized access.`,
        $localize`We may suspend or terminate access if we reasonably believe your use creates security, legal, operational, or abuse risks.`,
      ],
    },
    {
      heading: $localize`AI output and product changes`,
      body: [
        $localize`LivingWiki may generate summaries, wiki pages, citations, and chat answers using automated systems. Those outputs can be incomplete or incorrect and should be reviewed before being relied on.`,
        $localize`LivingWiki answers are generated from available source material, public information, uploaded documents, verified local sources, and user-submitted updates, and may require human review.`,
        $localize`We may change, improve, limit, or discontinue features at any time, including public atlas behavior, storage limits, or usage controls.`,
      ],
    },
    {
      heading: $localize`Disclaimers and liability`,
      body: [
        $localize`LivingWiki is provided on an as-is and as-available basis without warranties of any kind, to the fullest extent permitted by law.`,
        $localize`To the fullest extent permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive damages, or for loss of data, profits, or business arising from use of the service.`,
      ],
    },
  ],
};

@Component({
  selector: 'app-legal',
  imports: [RouterLink, ThemeToggleComponent],
  templateUrl: './legal.html',
})
export class LegalComponent {
  private readonly route = inject(ActivatedRoute);

  readonly page = computed<LegalPageContent>(() =>
    this.route.snapshot.data['legalPage'] === 'privacy' ? PRIVACY_CONTENT : TERMS_CONTENT,
  );
}
