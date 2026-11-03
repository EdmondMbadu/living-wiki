# Live visitor language flow

## Product behavior

The board setting **Ask visitors to choose a language on their first visit** defaults to off, including legacy boards. With the setting off, a visitor enters Live directly using their confirmed saved language or English. With the setting on and no confirmed saved choice, the first-visit chooser opens before playback. Phones use a full-screen first-visit chooser; desktop uses a centered modal. The browser language is suggested in the chooser.

The globe remains available independently of that setting. It replaces the former top playback button; the adjacent speaker controls narration/playback, including cover playback. The existing bottom **Let’s go** action is retained. Mid-visit language switching uses a phone bottom sheet or desktop menu. Opening the chooser pauses playback; cancel restores the previous language and playback intent. Confirm updates displayed card content and narration, preserves the current frame and scanned-card URL, and saves the choice.

The confirmed preference is `livingwiki.liveLanguage` (`en`, `fr`, `ja`, `pt`, `es`, `de`, `zh`, `it`, `ko`, `ar`, `hi`, or `ru`). It applies across boards on the same browser/device. Merely taking the English default does not record a confirmed choice. Explicit language parameters and localized URL prefixes on shared links take precedence over saved preferences. Neutral QR links use the saved preference or English. An enabled first-visit prompt still appears for localized QR links when there is no saved preference. If browser storage is unavailable, the chosen language works for the current visit.

Language changes in Live update content and narration in place; the surrounding application controls retain the locale of the URL's Angular build. Native language names make the chooser usable across those builds. The board-page content selector switches the corresponding localized site build for all twelve languages. The shared site switcher also offers all twelve interfaces, including the homepage. Arabic story text, question suggestions, and conversation input use right-to-left direction. Playback controls and progress retain their order. See [the twelve-language plan and map](twelve-visitor-languages.md).

## Preparation order

1. Resolve the board, scanned card, and visitor language.
2. Request only that published card and the small board header context. A cover/ending uses a separate cover request. Tour handoffs require both adjacent stops.
3. Reuse a valid per-card cache, or compatible existing whole-board translation. A bounded 24-entry browser cache avoids a network round trip when switching back to a recently viewed card/language in the same board revision. Translate missing content with Gemini.
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

Local verification passed: **139 focused browser tests**, **261 emulator/rule integration tests**, **12 chooser layout checks** across desktop and two phone window sizes, complete **6,939-message catalogs** for every translated site interface. The site follow-up expands this to twelve compiled interfaces and **142 focused browser tests**. The board feature is **441.0 KiB gzip**, within its existing **454.8 KiB** limit. Existing CSS-budget/CommonJS warnings remain.

The Firestore integration tests use an emulator and a mocked Gemini provider: they verify all twelve request languages, caching, unchanged source content, unrelated edits, changed-card invalidation, large boards, private/hidden cards, provider failure recovery, and concurrent visitors. These tests do not measure production Gemini or ElevenLabs latency.

For this language expansion, deploy `translateLiveCard`, `translateBoard`, `synthesizeChatAnswerSpeech`, `createElevenLabsVoiceSession`, and `boardShare` first. When also releasing the first-visit setting feature, include `teamCommand` and Firestore rules; deploy the localized Hosting build after those succeed. `getPublicTeamPage` also uses the updated public team projection and should be deployed with the team functions. This order ensures the new visitor UI has its backend and setting permissions available. Existing published team snapshots receive the setting on the next publication.

After deployment, test a public board and card QR in a fresh browser, with the admin prompt both off and on; then repeat with a saved language and all twelve language choices. Verify the songs board, regular boards, and tour handoffs. Confirm native narrator availability in the ElevenLabs account. Measure warm/cold time to text and first audio on phones, including slow requests. Browser debug entries report text readiness and first audio timing; backend logs report translation duration and reuse.

The character conversation component loads separately from the initial board bundle, with prefetch when a talking card is visible. The chooser loads immediately when opened; both Live and normal board language lists scroll within the viewport.

Streaming audio and admin bulk language preparation are separate follow-ups after measuring this version. This implementation reuses the existing complete-clip playback path and makes no fixed latency guarantee.

## Progressive translation on regular boards

Regular board pages use the callable `translateBoard.stream()` response: validated sections appear as they finish, while the remaining authored text stays readable. Progress shows translated text sections. Only a complete result is saved in the browser's session cache, keyed by board, revision, language and exact source text; it survives navigation between compiled locale pages. Switching language or entering Live aborts the obsolete client stream, and revision/language guards reject late results. Edited source cannot reuse the previous browser entry.

Both translation endpoints load a small runtime module and share `gemini-3.1-flash-lite`, with minimal thinking, short requests, three concurrent workers and deduplication of repeated narration/summary text. Heading text has its own request. Server caches keep the existing fingerprint/schema contract, access checks, quotas and approved text fields. A second visitor can follow the first request's validated partial cache without starting another provider job. Failed quota checks release their lease for retry.

To measure translation requests on a public board (uses the existing provider for uncached languages):

```bash
npm --prefix functions run build
node scripts/measure-board-translation.mjs BOARD_ID es,ja /tmp/translation-timings.json
```

The report separates first visible text, full completion and repeat cache hits. The measured example is in `docs/translation-latency.json`; it is a sample, not a latency guarantee. Network, function cold starts, board length and provider load can change response times.
