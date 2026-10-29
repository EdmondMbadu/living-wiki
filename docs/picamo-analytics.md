# Picamo analytics

Platform administrators open `/admin/analytics?tab=picamo` from the existing Platform analytics page. Overview, board analytics and card analytics remain independent. Every report callable verifies the current server-side user role; direct client access to all `picamo_analytics_*` collections is denied.

## Definitions

- Conversations are text sessions plus provider-verified voice calls. One conversation with eight user questions is one conversation and eight messages.
- A text session begins with the first accepted user interaction. Reopening the assistant does not create a session. A new city chat or 30 minutes without activity starts a new one. Both browser identities and server scope pointers enforce inactivity segmentation.
- Voice credential issuance, greetings, silence markers, and provider calls still processing do not count. Calls appear after provider verification; recovery also works when the browser closes before attaching the provider ID.
- Voice tool invocations have no independent text tracking identity. They remain part of their call, and are not added as text chats.
- User messages include local assistant interactions (for example choosing visibility), user text submissions, and final provider transcript user turns. Stream fragments, replies, tools, and duplicate deliveries are excluded.
- Answer success and average answer time cover measured text backend handlers only. Local interface steps do not claim a successful AI answer. Voice call duration never becomes text response latency.
- Voice minutes use provider call duration, with seconds split at UTC midnight. Unknown duration remains null. Text duration is elapsed time from first to last accepted user message, not time actively spent typing or speaking.
- Conversation counts belong to the start date, while messages and voice seconds belong to the dates on which they occurred. A conversation started before a selected range can contribute messages/time without a new conversation in that range. Recent conversations list sessions **started** within the chosen range.
- Active accounts and guest browsers are exact distinct actor sets across the range and selected source/city. They are not added from daily distinct totals and cannot be combined into a measured people count.
- Ordinary board owners and team members count as real assistant users. Only platform-admin sessions are internal testing, excluded by default. Classification is server-side at capture. Automated QA and non-Picamo city persona overrides are excluded.

## Capture and verification

The assistant uses `recordPicamoAssistantInteraction` to register local user interactions. `kiwiTalk` joins the same request receipt and records its backend outcome. The helper never stores the submitted text, transcript, email, raw account UID, or prompt in analytics. Account/browser identifiers are hashed. Client finish notifications cannot overwrite a verified backend success/failure or manufacture a successful model response.

Signed-in, public and streamed city answers join the same tracker after existing thread and context validation. Backend city-guide configuration establishes Picamo identity; a client-provided name cannot classify another persona as Picamo. QA sandbox and board/card chat contexts remain outside this tracker.

`kiwiVoiceSession` and city `createElevenLabsVoiceSession` issue a `pca_` nonce as the provider user ID. `syncPicamoVoiceAnalytics` checks the issuing actor and verifies the provider's nonce, agent ID, conversation ID, final state and start timestamp. Durable provider receipts prevent replay. Provider transcript contents are counted and discarded rather than copied to analytics. The existing `recoverCardVoiceAnalytics` schedule also runs a bounded Picamo recovery pass, with backoff and a 24-hour verification window. There is no additional scheduled service or always-warm instance.

## Storage and reporting

`picamo_analytics_requests` holds idempotent request receipts; `picamo_analytics_scopes` holds inactivity pointers. `picamo_analytics_sessions` contains session metadata and safe detail fields. `picamo_analytics_daily` aggregates by UTC day, source, city, internal status and actor shard. `picamo_analytics_participants` supplies exact distinct identities; it contains metadata, not content. Voice jobs and provider receipts are separate. Aggregates and receipts are durable, independent of transcript retention.

The report caches summary data for at most 30 seconds per function instance. Refresh bypasses that cache. Recent sessions use indexed cursor pagination rather than fetching the whole history. Chart clicks narrow only the recent-session list. Day/month/year summaries retain the full report range. Session CSV exports include all matching rows up to an explicit 20,000-row limit and include duration basis and capture coverage. Formula-leading text is escaped.

Aggregate and distinct-participant reads each have a 50,000-record limit. A report exceeding either limit returns an explicit request to shorten the range; it never silently truncates or approximates totals. Missing history is shown as unavailable, and mixed coverage/today are marked as partial. A valid date after tracking begins with no activity is a measured zero.

There is no historical import: surviving old city records do not reliably establish which guide persona was active at the time, and assistant conversation history was not persisted. Tracking starts with the first captured interaction. Analytics failures are logged without user content and do not fail the underlying conversation.

## Release

Build and validate first:

```
npm --prefix functions run build
npm run test:firestore-rules
npx ng test --watch=false --browsers=ChromeHeadless '--include=src/app/platform-analytics/*.spec.ts' '--include=src/app/picamo-tracking.service.spec.ts' '--include=src/app/kiwi/*.spec.ts'
npm run build:hosting
```

Deploy Firestore rules and indexes before serving the new tab. Deploy only these function groups sequentially to avoid a whole-project CPU burst:

1. `getPicamoAnalytics,recordPicamoAssistantInteraction,syncPicamoVoiceAnalytics`
2. `kiwiTalk,kiwiVoiceSession,createElevenLabsVoiceSession`
3. `askAtlas,askPublicAtlas,askAtlasStream`
4. `recoverCardVoiceAnalytics`

Then deploy Hosting when publishing the UI. Existing clients remain compatible because new tracking fields and voice session IDs are optional. A refreshed client is needed for text instrumentation; city voice capture is activated server-side. No paid model or voice call is needed for the automated regression suite.

## Verification on 2026-10-29

- 256 Firestore/rule integration tests passed, including 13 new Picamo cases.
- 60 focused browser tests passed across Picamo, platform analytics, and existing board/card analytics.
- All six translated catalogs contain 6,939 complete messages with matching placeholders. The seven-language production build, prerendering and bundle budgets passed.
- A real signed-in admin sent two local-only assistant messages, closing/reopening the panel between them. The report returned one text conversation, two user messages, and no invented model-answer success. The exported CSV contained the same session, message count, admin flag, and elapsed-time basis. With admin testing excluded, all four visitor totals were zero and the test session was absent.
- Desktop and mobile layouts were inspected; chart and recent-table overflow are contained in their scrolling panels. The existing Overview loaded its real inventory and board creation history after switching tabs.
- All ten affected Cloud Functions were verified ACTIVE. All 15 new session indexes were verified READY. Rules, indexes, targeted functions and Hosting were deployed successfully. Paid Gemini generation and live voice calls were not required for validation; provider verification, silence exclusion, replay prevention, unknown duration and UTC splitting were covered by emulator fixtures.
