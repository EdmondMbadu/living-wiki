# Twelve visitor languages

## Plan and scope

Add Italian (`it`), Korean (`ko`), Arabic (`ar`), Hindi (`hi`), and Russian (`ru`) to the seven existing visitor languages. Preserve the existing distinction between the seven compiled application interfaces and the visitor's independently selected content language. Do not expose nonexistent application locale routes or manufacture untranslated application catalogs.

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
