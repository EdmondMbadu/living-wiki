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

The Hosting predeploy hook runs `npm run build:hosting`, so a plain `firebase deploy` rebuilds all twelve interfaces and checks production performance budgets before publishing. This prevents deployment of a stale seven-language build. Deployment itself is a separate operation from local validation.

For website changes, use `npm run deploy:hosting`. For backend changes or recovery from a partial deployment, deploy only the affected functions:

```bash
npm run deploy:functions -- translateBoard translateLiveCard
# Inspect the exact targets without sending a deployment:
npm run deploy:functions -- --dry-run translateBoard translateLiveCard
```

The helper validates names against the compiled exports and updates five functions at a time by default. It refuses to overlap another Firebase deployment, stops at the first failed batch, and prints the unfinished targets for retry. Use `--batch-size=1` if the regional CPU quota is still exhausted. Hosting and database rules are deployed separately, so a function retry does not rebuild all twelve interfaces.

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
another AI. Only the avatar name and the public context you explicitly enter go
into that prompt; persona instructions and source documents are not included.
Upload the returned JSON or paste it, review the questions, name the test, then
select **Run imported questions**. Nothing runs on import alone.

Version 1 accepts 1–50 English single-turn questions, a 256 KiB file maximum,
and the five current stress categories. Each question needs `id`, `category`,
`question` (up to 1000 characters), and `expectedBehavior` (up to 1600 characters).
Use the downloaded example for the full envelope. Duplicate IDs/text, unknown
fields (including supplied grades or answers), and invalid categories are rejected
in both the browser and the callable. Expected behavior is untrusted test evidence;
it cannot override the independent assessment rules.

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
