# TalkThrus landing page

The public Angular route `/talkthrus` implements Jim's October 26, 2026 city-neutral PDF and HTML reference. It focuses on winning listing appointments, with the three-line hero, interactive English/Spanish introduction example, video preview, human-advantage callout, three preview tabs, appointment workflow and time cards, Listing Story Kit, five bonuses, 48-hour promise, agent/agency cards, pricing, founding-agent offer, contact form, and about/footer sections.

## Design and navigation

Jennifer Jones's unobstructed original portrait from the public example board is stored locally as `jennifer-jones-portrait.jpg`. The agent preview uses a larger rounded portrait frame that preserves her complete face and smile on desktop and mobile; the hero uses the same clean photo in its avatar. The supplied bay-view photos and TalkThrus mark are served from `public/assets/talkthrus`. Newsreader regular and italic are hosted locally with their OFL license; the existing site Inter font supplies body text. Styles are scoped to the component. The floating Picamo launcher is hidden only while this landing page is present, to keep campaign buttons clear; an already-open assistant remains accessible.

Section links resolve against the locale base URL, preserving English, French, Spanish, Portuguese, German, Japanese, and Chinese routes. The contact form is at `#start`; the previous `#signup` anchor remains supported. The live example opens the existing public board in a new tab. Preview tabs support arrow keys, Home, and End, with linked tab panels and visible focus indicators.

The video cover matches the reference's side-by-side treatment. Its play button creates and starts the existing 38-second Margot introduction, with native controls and inline mobile playback. The square MP4 retains its complete frame and baked-in English captions. No video downloads until play is requested. A direct MP4 link remains available if playback fails.

## Offers and checkout

- Solo Agent and Agent Pro retain the existing Stripe checkout and annual/monthly prices from the shared billing catalog. Trial/card terms and the one-free-TalkThru path remain visible.
- Done For You is advertised at **$199 per listing**, independent of the subscription billing cycle. Its booking button opens the inquiry form with that service selected. The form collects no payment and does not create a subscription or automatically grant Agent Pro.
- Agency & Team retains team creation, team billing, and the catalog's graduated seat pricing. The team card spans the full row on desktop as in the PDF.
- Founding-agent and city-waitlist buttons select the request type and collect a city/market. Miami, Austin, and Charlotte display the reference's **25 founding seats per market** allocation. This is capacity, not an invented count of remaining seats. No fabricated occupancy bars or signup counts are shown.

The new promises (48-hour fulfillment, bonuses, founding-rate lock, first Done For You listing free, and the included Agent Pro month) require the team's manual fulfillment. Booking submission does not start the 48-hour clock, take payment, reserve inventory, or change billing. Existing product gaps around multilingual personal narration, room replays, and neighborhood cards remain documented in `talkthru-billing.md`; this landing-page update does not implement those product features.

## Inquiry handling

The form calls `submitTalkThruInterest`, requiring a name, valid email, agency, and explicit contact consent. Optional listing links must use HTTPS. Founding-agent and waitlist requests also require a city. The backend validates the optional `requestType` (`free`, `done_for_you`, `founding`, `waitlist`, `general`) and `city` fields, while remaining compatible with older records that have neither.

Accepted requests are stored in the private `talkthru_interests` Firestore collection. The existing email trigger sends applicant confirmations and admin alerts to Jim and Edmond. Both email variants include the service and city. The admin queue displays and searches these fields alongside the existing status, notes, archive and email-delivery controls. Honeypot, consent, IP/email rate limits, and retry idempotency remain intact.

Deploy the changed inquiry callable and admin read callable before Hosting. The email trigger must also be deployed to include the new details in confirmations and admin alerts:

```sh
npm --prefix functions run build
firebase deploy --only functions:submitTalkThruInterest,functions:listTalkThruInterests,functions:updateTalkThruInterest,functions:sendTalkThruInterestEmails,functions:retryTalkThruInterestEmails --project living-atlas-7622a
npm run build:hosting
firebase deploy --only hosting --project living-atlas-7622a
```

## Verification

- `npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/talkthrus/talkthrus.spec.ts --include=src/app/admin-users/talkthru-interests-admin.spec.ts`
- `npm --prefix functions run test:talkthru-interest`
- Existing billing, billing-flow, and Stripe test suites verify subscription behavior and catalog parity.
- `npm run build:hosting` validates all locale catalogs, production compilation, prerendering, runtime configuration, and bundle budgets.

Browser QA covers preview/language controls, subscription prices, guest checkout navigation, service/city selection, validation, mocked form failure/retry/success, native video playback, section anchors, and responsive overflow checks. Test inquiries must be intercepted or run against an emulator so they do not send real emails.
