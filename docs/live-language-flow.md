# Live visitor language flow

## Product behavior

The board setting **Ask visitors to choose a language on their first visit** defaults to off, including legacy boards. With the setting off, a visitor enters Live directly using their confirmed saved language or English. With the setting on and no confirmed saved choice, the first-visit chooser opens before playback. Phones use a full-screen first-visit chooser; desktop uses a centered modal. The browser language is suggested in the chooser.

The globe remains available independently of that setting. It replaces the former top playback button; the adjacent speaker controls narration/playback, including cover playback. The existing bottom **Let’s go** action is retained. Mid-visit language switching uses a phone bottom sheet or desktop menu. Opening the chooser pauses playback; cancel restores the previous language and playback intent. Confirm updates displayed card content and narration, preserves the current frame and scanned-card URL, and saves the choice.

The confirmed preference is `livingwiki.liveLanguage` (`en`, `fr`, `ja`, `pt`, `es`, `de`, or `zh`). It applies across boards on the same browser/device. Merely taking the English default does not record a confirmed choice. Explicit language parameters and localized URL prefixes on shared links take precedence over saved preferences. Neutral QR links use the saved preference or English. An enabled first-visit prompt still appears for localized QR links when there is no saved preference. If browser storage is unavailable, the chosen language works for the current visit.

Language changes in Live update content and narration in place; the surrounding application controls retain the locale of the URL's Angular build. Native language names make the chooser usable across those builds. The existing board-page language selector continues switching the entire localized site build.

## Preparation order

1. Resolve the board, scanned card, and visitor language.
2. Request only that published card and the small board header context. A cover/ending uses a separate cover request. Tour handoffs require both adjacent stops.
3. Reuse a valid per-card cache, or compatible existing whole-board translation. Translate missing content with Gemini.
4. Display translated text as soon as the active card is complete. Keep its image and navigation available during preparation.
5. Prepare that card's ElevenLabs audio through the existing narration cache and playback system.
6. Prepare only the next frame's missing translation/audio in the background. Browser scheduling limits translation requests to two concurrently and gives newly selected cards priority. Obsolete queued work is skipped; already-running work may finish into its appropriate cache.
7. Check board revision, language, and frame before applying results or playing audio. Pause and clear stale speech on language changes.

Changing only the language prompt or visitor visibility preserves published video revisions. The normal board view keeps its whole-board translation flow. Partial Live results are never considered a complete board translation.

## Backend and persistence

- `translateLiveCard` reads source content on the server. It validates board visibility and the selected card, and excludes author-only cards and unrelated quizzes/cards. Browser-supplied text is not used.
- `board_card_translations` stores server-only translations per board/language/card (including a separate cover key). Fingerprints include the selected card and header text, so unrelated card edits or ordering changes do not invalidate that card's cache.
- A transaction lease deduplicates concurrent visitors. Completion/error updates check lease ownership. Provider and quota failures release the lease for retry.
- Limits apply to uncached generation, with per-visitor request and character budgets. Existing speech limits remain in force.
- Personal/team narrator authorization recognizes current validated per-card caches. Tour authorization also checks the next stop's cache. Existing native voice checks and browser audio restrictions remain in force.
- `askVisitorLanguage` is persisted by focused board settings writes, validated as a boolean, and included in published team snapshots.

## Verification and release

Run `npm run test:languages`, `npm run test:firestore-rules`, `npm --prefix functions run build`, the existing board translation/native voice/agent language/tour tests, and `npm run build:hosting`.

Local verification passed: **95 focused browser tests**, **175 emulator/rule integration tests**, complete **6,662-message catalogs** for every translated site locale, and the seven-language production Hosting build. The board feature is **453.1 KiB gzip**, within its existing **454.8 KiB** limit. Existing CSS-budget/CommonJS warnings remain.

The Firestore integration tests use an emulator and a mocked Gemini provider: they verify all seven request languages, caching, unchanged source content, unrelated edits, changed-card invalidation, large boards, private/hidden cards, provider failure recovery, and concurrent visitors. These tests do not measure production Gemini or ElevenLabs latency.

Deploy `translateLiveCard`, `synthesizeChatAnswerSpeech`, `teamCommand`, and Firestore rules first; deploy the localized Hosting build after those succeed. `getPublicTeamPage` also uses the updated public team projection and should be deployed with the team functions. This order ensures the new visitor UI has its backend and setting permissions available. Existing published team snapshots receive the setting on the next publication.

After deployment, test a public board and card QR in a fresh browser, with the admin prompt both off and on; then repeat with a saved language and all seven language choices. Verify the songs board, regular boards, and tour handoffs. Confirm native narrator availability in the ElevenLabs account. Measure warm/cold time to text and first audio on phones, including slow requests. Browser debug entries report text readiness and first audio timing; backend logs report translation duration and reuse.

Streaming audio and admin bulk language preparation are separate follow-ups after measuring this version. This implementation reuses the existing complete-clip playback path and makes no fixed latency guarantee.
