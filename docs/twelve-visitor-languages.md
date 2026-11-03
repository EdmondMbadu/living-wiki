# Twelve visitor languages

## Plan and scope

Add Italian (`it`), Korean (`ko`), Arabic (`ar`), Hindi (`hi`), and Russian (`ru`) to the seven existing visitor languages. Visitor language can still be selected independently in Live. The subsequent site expansion now also provides twelve complete compiled application interfaces, including the homepage and shared site language switcher.

1. Centralize visitor language metadata for native labels, browser locale matching, speech locales, direction, and voice preferences. Map browser regional variants and `contentLang` QR parameters to all twelve visitor languages without changing application routes.
2. Extend server validation, translation instructions, source detection, native voice selection, conversation instructions, talking-card labels, tour handoffs, and share links. Preserve native voice readiness checks and explicit text fallback when the external voice account is not configured.
3. Make the twelve-choice dialog scroll on short/mobile screens with confirmation reachable. Apply Arabic direction to translated content and conversation text without reversing playback controls or timeline order.
4. Preserve current-card-first translation, bounded concurrency, next-card prefetch, request deduplication, and language-separated audio caches. Test stale responses during rapid switching.
5. Run focused browser tests, backend language tests, Firestore emulator integration tests, and the production hosting build/performance check. Document the difference between mocked integration validation and real provider latency/account readiness.

## Flow map

QR/route + saved visitor preference → Live chooser → validated content language → selected-card translation/cache → translated card and conversation opening/starters → native narration/cache → current-character conversation language/voice overrides. Tour handoffs and shared-card links carry the same language. Browser speech fallback must select a matching language, never an unrelated default voice.

## Release requirements

Deploy updated translation, narration, voice-session, and share functions before the frontend. The ElevenLabs agent must have all requested language presets, language/voice overrides, and account-accessible verified voices for the configured speech models. Code support alone does not establish external account readiness or production timing.

## Verification results

- 139 focused Chrome tests passed, including the five new visitor preferences, QR language preservation, native browser speech matching, voice-session requests, Arabic direction, stale audio rejection, and switching back without another translation request.
- 261 Firestore emulator/rule integration tests passed; all twelve language codes generate and reuse independent selected-card caches. Translation provider responses are mocked.
- All four actual Angular chooser tests passed in each of three Chrome window configurations (800×600, 390×844, 320×568): 12 layout checks. A separate headless layout harness also verified that scrolling the last choice leaves the confirmation button within the viewport.
- Backend board translation/source detection, verified-native-voice/model matching, agent language readiness, and tour-handoff authorization tests passed. New handoff copy is identical between browser and server.
- Application and focused-test TypeScript checks passed. Production build validates all seven interface catalogs (6,939 messages each); no language catalogs or interface routes are claimed for the five additional visitor content languages.
- Initial board code is reduced by deferring character conversations and prefetching when a talking card is visible. The measured board bundle is 441.0 KiB gzip, below the unchanged 454.8 KiB ceiling. Existing stylesheet/CommonJS warnings remain.

No cloud deployment, external agent configuration change, billable production translation/audio generation, or real-provider latency measurement was performed as part of local implementation. After deployment, confirm the configured account has the requested agent presets and verified voices, then use `node scripts/verify-board-language-live.mjs BOARD_ID REPORT_PATH it,ko,ar,hi,ru` for a public narrated board. That command calls production translation and narration and may incur provider charges; it does not start a realtime character conversation. Also test one actual character conversation per language on a phone.

## Site interface and runtime follow-up

The homepage and every shared site switcher now use all twelve locales from `SUPPORTED_LOCALES`. Five complete additional Angular catalogs provide Italian, Korean, Arabic, Hindi, and Russian interfaces. Each locale has a compiled route, local server fallback, Firebase rewrite, and development configuration. The document language and Arabic direction are set during both browser rendering and prerendering. The global menu scrolls on short screens.

Functions now target Node 22 in both package metadata and Firebase configuration; `.nvmrc` and the root package engine align development tooling. Hosting predeploy builds the full localized application, avoiding stale deployments. The local Node 22 smoke check loads all 216 function exports; the installed Firebase CLI runtime guard accepts Node 22 and reproduces the Node 20 decommission error. No cloud deployment is needed to make these local changes reviewable.

The earlier seven-interface scope above records the first visitor-language implementation. This follow-up supersedes that scope: site interfaces and visitor content now both offer twelve languages.

### Site follow-up validation

- All 11 translated catalogs contain 6,939 source-matched entries with preserved placeholders. Arabic received an additional review of untranslated controls and longer passages; common product terms are maintained in the shared overrides file.
- 142 focused browser tests and five Hosting runtime-configuration tests pass. The production Hosting build passes with 204 HTML pages; the initial board bundle remains 441.0 KiB gzip below its existing 454.8 KiB limit.
- The localhost server was changed from the English-only `ng serve` process to `scripts/serve-localized.mjs` serving the production build on both loopback addresses at port 4200.
- Actual Chrome checks selected Italian, Korean, Arabic, Hindi, and Russian from the shared homepage menu and verified each page's locale and translated tagline. Arabic uses `dir=rtl` in both prerendered HTML and the browser. A fixed sidebar control was changed to logical positioning after it was found to overlap the language button; the final browser check confirms the language button is unobstructed with the RTL sidebar open.
- The English homepage is left with all twelve choices open. No production deployment was run; deployment configuration and the local Node 22 function-discovery smoke check were verified independently.
