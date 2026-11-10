# LivingWiki

LivingWiki is an Angular app prepared for Firebase Hosting, with the Firebase Web SDK initialized on the client for future Auth and Firestore integration.

## Development server

Use Node.js 22 for local tooling and Firebase Functions (the project includes `.nvmrc`). If you use nvm:

```bash
nvm install
nvm use
```

To build and serve all twelve languages together at `localhost:4200`, run:

```bash
npm start
```

The localized server mirrors Firebase's locale fallbacks. Interfaces are available at `/`, `/fr/`, `/ja/`, `/pt/`, `/es/`, `/de/`, `/zh/`, `/it/`, `/ko/`, `/ar/`, `/hi/`, and `/ru/`. For example, `/ar/home` is the Arabic homepage. Arabic sets the document direction to right-to-left; Live playback controls keep their established order.

`npm run start:dev` is an English-only development server with automatic reload. To test language switching between routes, use `npm start`. Single-locale development builds are available with `npm run start:fr` (and `ja`, `pt`, `es`, `de`, `zh`, `it`, `ko`, `ar`, `hi`, or `ru`).

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Guest terms acceptance

Signed-out visitors can browse without accepting terms. The first time they start
an avatar voice or typed conversation, `GuestTermsService.requestConversation()`
waits for authentication restoration and opens a consent dialog if needed. No
conversation request or microphone connection starts before acceptance. Existing
signed-in accounts and returning guests who have accepted the current policy skip
the dialog. Not now, Escape, dismissing the dialog, or navigating away cancels the
pending conversation while leaving browsing available. Old `/guest-terms` URLs
redirect to browsing instead of forcing a standalone acceptance screen.

Acceptance is stored under `livingwiki.guest-terms-acceptance` in localStorage, with
an acceptance timestamp and the version/effective date from
`src/app/legal/terms-policy.ts`. A different device, cleared storage, or a revised
policy requires acceptance again when starting a conversation. Failed storage
keeps the conversation blocked, with a recovery message. This is a browser
interaction gate and a local acceptance record, not a server-side audit log or API
authorization boundary.

Run `npm run test:guest-terms` for isolated persistence, dialog, conversation, and
navigation tests. They use fake storage, not a real visitor’s acceptance record.

## Internationalization

The shared site language switcher offers English, French, Japanese, Brazilian Portuguese, Latin American Spanish, German, Simplified Chinese, Italian, Korean, Arabic, Hindi, and Russian. Angular builds a separate localized application per locale, so navigation, page controls, accessibility labels, and locale-aware formatting use the selected interface language without runtime translation requests.

Localized board routes request content and narration in the same language. `?contentLang=LANGUAGE_CODE` explicitly selects one of the twelve visitor languages; `?contentLang=original` preserves authored content when entering or leaving Live. Team working copies remain editable in their authored language by default.

To verify actual translation and speech generation for one public board (uses live services and may incur translation/audio charges):

```bash
node scripts/verify-board-language-live.mjs BOARD_ID /tmp/board-language-report.json
```

When adding or changing visible copy:

```bash
npm run i18n:mark
npm run i18n:extract
# update every translated src/locale/messages.*.json catalog
npm run i18n:check
npm run build
```

Use `npm run start:LANGUAGE_CODE` for a single localized development build. The
production build fails on missing or duplicate translations, and `i18n:check` additionally
rejects stale message IDs or changed placeholders.

Spanish copy is neutral Latin American Spanish (`es-419`) and addresses the reader with *tú*
(never *usted* or *vosotros*). Product names such as LivingWiki, TalkThru, Picamo, and plan names
stay in English. `python3 scripts/translate-angular-catalog.py es-419` drafts any missing entries.

The five additional catalogs are drafted with the existing offline Argos workflow. Reviewed navigation, homepage, and Live terminology lives in `scripts/locale-overrides.it-ko-ar-hi-ru.json`; placeholder and catalog completeness checks run before every Hosting build.

To add another language, add it to `src/app/i18n/locales.ts`, `angular.json`, the catalog
checker/translation target list, and Firebase's locale fallback rewrites. Then create a complete
target catalog before enabling the production locale build. The language switcher reads the
shared locale manifest, so it does not require page-by-page changes.

## Firebase Hosting

This repo is configured for Firebase project `living-atlas-7622a`. Functions target `nodejs22` in `firebase.json` and Node 22 in `functions/package.json`; the lockfile agrees. Node 20 is decommissioned and must not be restored. See the [Firebase runtime guidance](https://firebase.google.com/docs/functions/manage-functions).

The Hosting predeploy hook runs `npm run build:hosting` and checks all twelve interfaces and production performance budgets before publishing.

For website changes, use `npm run deploy:hosting`. For backend changes or recovery from a partial deployment, deploy only the affected functions:

```bash
npm run deploy:functions -- translateBoard translateLiveCard
# Inspect the exact targets without sending a deployment:
npm run deploy:functions -- --dry-run translateBoard translateLiveCard
```

For a full release, use `npm run deploy:all`. It deploys functions in batches of five with at least 60 seconds between batch starts, then publishes Firestore, Storage, and Hosting after the functions succeed. Use `npm run deploy:all -- --dry-run` to inspect the plan.

The helper validates names against the compiled exports, stops at the first failed batch, and prints the remaining targets for retry. If a previous Firebase run logged explicit failures, pass the log to recover just those targets:

```bash
npm run deploy:functions -- --failed-log=/path/to/deploy.log --batch-size=1 --dry-run
npm run deploy:functions -- --failed-log=/path/to/deploy.log --batch-size=1
```

Use `--batch-size=1` when recovering from a regional CPU quota error. If a single function still hits that quota, wait for capacity or check the project's regional CPU limit. A functions-only retry does not rebuild Hosting.

Deploying every function together can exceed Cloud Run's regional CPU quota and write-rate limit. Existing healthy revisions can remain active when a new revision fails, so `ACTIVE` alone does not prove that the latest code deployed. Check the deployment result and the latest revision. Firebase recommends [deploying only changed functions and using groups of ten or fewer](https://firebase.google.com/docs/functions/manage-functions#deploy_functions).

Local runtime config:

```bash
cp public/runtime-config.template.js public/runtime-config.js
```

Then fill in `public/runtime-config.js` with your Firebase web config. This file is intentionally ignored by git and must never be committed.

To enable Google Drive import on `/upload`, also add a `googleDrive` block to `public/runtime-config.js`:

```js
window.__LIVING_ATLAS_CONFIG__ = {
  firebase: {
    // existing Firebase web config
  },
  googleDrive: {
    apiKey: 'YOUR_BROWSER_API_KEY',
    clientId: 'YOUR_WEB_OAUTH_CLIENT_ID.apps.googleusercontent.com',
    appId: 'YOUR_GOOGLE_CLOUD_PROJECT_NUMBER',
  },
};
```

Google Drive import setup checklist:

1. In the same Google Cloud project used by Firebase, enable both the Google Drive API and Google Picker API.
2. Create or reuse a browser API key that allows requests from your app origin.
3. Create a Web OAuth client ID and add your local origin such as `http://localhost:4200` plus your production domain.
4. Put the API key, OAuth client ID, and project number into `public/runtime-config.js`.
5. Restart `ng serve` if the runtime config file was added after the dev server started.

To enable the bottom Google AdSense unit on `/atlas/philly`, add your publisher client and ad slot to `public/runtime-config.js`:

```js
window.__LIVING_ATLAS_CONFIG__ = {
  firebase: {
    // existing Firebase web config
  },
  googleAdSense: {
    clientId: 'ca-pub-YOUR_PUBLISHER_ID',
    phillyBottomSlotId: 'YOUR_AD_SLOT_ID',
  },
};
```

Imported Google Workspace files are converted into formats the current ingestion pipeline already supports:

- Google Docs -> `.docx`
- Google Slides -> `.pptx`
- Google Sheets -> `.pdf`
- Standard Drive PDFs, text files, Word docs, PowerPoints, and PNG/JPEG images are downloaded directly

Build for hosting:

```bash
npm run build:hosting
```

Deploy to Firebase Hosting:

```bash
firebase login --reauth
npm run deploy:hosting
```

Board-save changes that update both `firestore.rules` and the web client must be
deployed together:

```bash
npm run test:firestore-rules
npm run deploy:board-saves
```

`deploy:hosting` updates only Hosting; it does not publish Firestore rules.

### Spotify playback

The Spotify Developer app must allowlist this exact production redirect URI:

```text
https://livingwiki.com/auth/spotify/callback
```

It is case-sensitive and must not include a trailing slash. Deploy both Functions and Hosting
after changing the Spotify OAuth integration so the authorization request, token exchange, and
Hosting callback route continue to use the same URI.

## Importing external avatar QA questions

In an authorized card’s **Avatar testing** page, select **Import questions**.
**Export examples & AI prompt** provides a versioned JSON example and a prompt for
another AI. The downloaded JSON embeds the same strict generation instructions
shown in the copyable prompt. Choose an output count (default 50); the six template
questions illustrate the format, not the requested number of generated questions.
Only the avatar name and the public context you explicitly enter go
into that prompt; persona instructions and source documents are not included.
Upload the returned JSON or paste it, review the questions, name the test, then
select **Run all questions**. Review initially shows five questions, with controls
to reveal five more, show all, or collapse. Run buttons at both ends always submit
the entire validated suite. Nothing runs on import alone.

Version 1 accepts 1–50 English single-turn questions, a 256 KiB file maximum,
and exactly these category values: `instructions`, `privacy`, `accuracy`, `harmful`,
`boundaries`. Each question needs `id`, `category`,
`question` (up to 1000 characters), and `expectedBehavior` (up to 1600 characters).
Use the downloaded example for the full envelope. Duplicate IDs/text, unknown
fields (including supplied grades or answers), and invalid categories are rejected
in both the browser and the callable. Expected behavior is untrusted test evidence;
it cannot override the independent assessment rules. Optional root-level
`generationInstructions` is accepted for starter-file round trips (a nonempty
string, at most 16000 characters), then discarded before execution. It cannot
change allowed categories or assessment rules. Generated files should omit it.

Imported runs use the existing private stress protocol, configuration snapshots,
quotas, cancellation, history, PDF reporting, and private repair/retest flow.
**Export answers JSON** downloads questions, actual responses and assessments,
without exporting the private configuration snapshot or persona. Importing a test
does not modify the avatar. Responses are persisted before assessment, including
when the evaluator fails or a worker times out. A final score still requires every
question to be assessed.

Validation:

```bash
npm run test:avatar-qa
npm --prefix functions run test:avatar-qa
npm run build
```

For rollout, deploy `avatarQaCommand`, `runAvatarQaCase`, and
`recoverAvatarQaCases` with the functions deployment helper, then deploy Hosting.
Deploying the frontend alone does not add the new backend actions.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
# living-atlast

## Talking Card sponsorship acknowledgements

Avatar creation and **Edit Talking Card → Sponsorship** use the same **Off** /
**Add a sponsor** controls. New avatars start Off. Enter a name to fill the default
message, then edit the visible **Sponsor message** field freely. Custom wording is
preserved when changing the name. There are no shared-board controls in the editor.
An existing inherited acknowledgement is loaded as editable local text; saving
changes only that card's explicit sponsorship choice, never a shared default.
Sponsor name is limited to 120 characters and exact message to 500.
Sponsorship is public visitor-facing text and is saved separately from the avatar
persona, so it requires no knowledge rebuild and does not follow the avatar onto
other boards. Unsaved settings are retained in the editor's local draft. When moving an existing
sponsor acknowledgement here, remove the old sponsorship instruction from the
avatar prompt to avoid a second, model-generated acknowledgement.

At the end of a meaningful voice conversation, the app disconnects the microphone,
shows the exact acknowledgement, plays cached speech in the saved avatar voice,
and offers the recap. **Skip to recap** remains available. Preparing audio is
limited to three seconds at closing; failed or blocked playback falls through to
the visible acknowledgement and recap. Closing the dialog, interrupted calls,
and typed conversations do not autoplay. Manual playback is available in the
recap. Acknowledgements are separate from the conversation transcript and AI summary.

The speech callable checks board/card access and resolves the saved message on the
server. It refuses stale text and does not accept visitor-supplied speech content
or narrator choices in sponsorship mode. Previewing unsaved wording requires board
ownership. Recap email reads saved sponsorship independently and includes its exact
text in both plain-text and escaped HTML, even if the generated summary omits it.
Disabling sponsorship takes effect on subsequent requests; existing audio is never
served without rechecking access. A failed preview does not block saving.

Validation: `npm run test:sponsorship`, `npm --prefix functions run test:sponsorship`,
`npm run test:firestore-rules`, and `npm run build`.

Rollout requires the updated `synthesizeChatAnswerSpeech` and
`sendVoiceConversationSummary` functions, Firestore rules, and Hosting. If using
team boards, also deploy `teamCommand` to preserve sponsorship in published snapshots. Deploy the
backend and rules before Hosting. This does not rebuild avatar knowledge or change
existing persona prompts. Long persona prompts now show an effective runtime-limit
notice in the Talking Card editor.


## Weekly updates for an account’s home city

The **Account** tab in Profile includes the saved city name and a **Weekly city
updates** switch. Home keeps the city chooser without the email setting. Updates
follow `users/{uid}.preferredCitySlug` (also reads the legacy
`preferred_city_slug`), never the display/local-storage fallback. Selecting a
university does not silently save the displayed city. Failed city saves show a
retry action; rapid selections save in order.

Existing and new accounts are eligible without a migration or another Home visit.
The weekly sender reads the current Firebase Auth record for the verified email,
checks the account is enabled, and rechecks the saved city and email preference
before sending. Accounts with no saved city, unverified email, a deleted/disabled
Auth account, or no public city wiki are skipped. No confirmation email is sent
when an account becomes eligible or changes city.

`cityWeeklyUpdatesPreference` is an authenticated get/set callable. Its private
`city_weekly_updates/{uid}` record defaults on unless a previous visitor
subscription for that email/account was unsubscribed. Explicit re-enabling is
supported. Switching off also stops matching visitor subscriptions; switching
cities never enables an opted-out account. Both the new account unsubscribe link
and existing visitor unsubscribe links turn account updates off. Account email
footers explain why the message was sent, link to Profile to manage updates, and
link to Home to change the saved city. Preferences, tokens,
cached content, and delivery receipts remain inaccessible to client SDKs under
the existing deny-by-default Firestore rules.

`sendWeeklyAtlasNewsletters` reuses existing newsletter generation, schedules,
templates and SendGrid. Public city wikis with no enabled/disabled newsletter
setting use the existing Monday 09:00 defaults in their city timezone (fallback:
America/New_York). Explicitly disabled newsletters stay paused, shown in Profile as
unavailable. Existing configured schedules remain in effect. City/recipient reads
are paginated; weekly content is cached per city/scheduled edition. Missed or
rejected sends can retry later on the scheduled day.

Transactional receipts in `city_weekly_deliveries` prevent repeat automatic sends
per account and account email in a UTC Monday–Sunday week, including after a city
change. Matching visitor signup mail is deduplicated per city/email/week. Existing
intentional visitor subscriptions to other cities are independent. Explicit
provider 4xx rejections release the claim for retry; a lost response or interrupted
send retains its `sending`/`uncertain` claim to avoid a possible duplicate. Such
receipts need provider-log review before manual recovery; a subsequent run records
`needs_review`. SendGrid does not provide an exactly-once send guarantee. Run
recipient counts describe that invocation, not cumulative retry totals.

Validation: `npm run test:city-weekly`, `npm run test:city-weekly:backend`,
`npm run i18n:check`, and `npm run build:hosting`. Backend tests use the local
Firestore emulator and a mocked email provider; they send no real email.

Rollout: deploy `cityWeeklyUpdatesPreference`, `unsubscribeCityWeeklyUpdates`,
`unsubscribeAtlasSubscription`, and `sendWeeklyAtlasNewsletters` before Hosting.
No Firestore rules/index changes or profile backfill are required. Deployment
activates automatic eligibility for existing accounts, so keep administrator
newsletter pauses in place for any city that should not send yet.
