# Platform analytics

`/admin/analytics` is accessible from Users and the admin account menu. The Angular admin guard controls navigation; each callable independently verifies `users/{uid}.role == 'admin'`. All platform analytics collections deny direct Firestore client access.

## Metric definitions

- **Boards / cards / talking cards:** current saved inventory, including private boards and drafts. A team board's working draft and published copy share one canonical board ID. Cards are deduplicated by ID within a board, including related cards. Talking cards require an Atlas conversation configuration and count placements, not distinct avatars.
- **Boards created over time:** boards whose saved creation timestamp falls within the selected UTC date range, grouped by day, month, or year. `platform_analytics_board_creations` keeps one minimal record per canonical board ID after deletion. Drafts and published copies count once. The earliest valid saved timestamp is retained; analytics import/edit times are never substituted. Missing, invalid, and future dates are excluded and disclosed. Earlier deleted boards that left no surviving record cannot be reconstructed. This chart covers all owners and is independent of the conversation audience filter and breakdown search.
- **Conversations:** a scoped text session or verified provider voice session with at least one user message. Greeting-only calls do not count. Automated QA has no card-session attribution and stays separate. Owners, avatar administrators, platform admins, and team members are internal sessions, shown by default in the authenticated analytics pages under **All activity**. **Visitors only** excludes them and **Internal only** isolates testing. Older API clients that omit an audience retain the visitor-only scope.
- **Voice time:** verified provider call duration, retained as seconds and formatted as minutes. Text elapsed-time estimates never become voice minutes. Unknown durations remain unknown. A call crossing midnight contributes seconds to both UTC dates; the conversation count belongs to its start date.
- **Active talking cards:** distinct board/card pairs with recorded conversations or voice time in the selected period.
- **Breakdowns:** current owner, board, or talking-card inventory joined with activity. Usage retains its owner when first recorded. Older imports use the best available ownership metadata. Deleted content can retain historical activity.
- **Data status:** pending/unverified voice sessions are current operational counts; failed answers and missing duration counts follow the selected period.

## Sources and durability

Current board and team-board writes update a minimal canonical inventory and sharded counters transactionally. Voice capture verifies provider conversation ID, agent ID, and a server-issued session nonce. Text capture reuses visitor conversation records and separately records minimal metadata for internal preview requests. Raw user questions are not added to the platform ledger.

`platform_analytics_usage` stores minimal durable session contributions, with source/provider receipts to prevent duplicate ingestion. `platform_analytics_daily` stores reversible aggregate contributions, allowing repeated events and late verification to update counts without duplication. Daily rows support month/year grouping beyond the 90-day transcript retention period. Deleting raw expired records does not delete aggregate contributions.

The initial background sync pages through canonical sources and surviving conversation records. Missing older activity is not reconstructable; the response exposes tracking start and coverage flags. Inventory remains in a preparing state until the initial sync completes. No sample values or guessed historical durations are returned.

## Operations

`startPlatformAnalyticsSync` starts or reuses a resumable reconciliation job. `platformAnalyticsWorker` processes 100 records per batch using a lease and step receipt, with idempotent ingestion. A worker drains subsequent pages within its runtime budget, and an administrator reading a stalled sync safely requeues its next step at most once per minute. The scheduled reconciler recovers stale leases and performs daily reconciliation. The UI offers retry and reconcile actions. Results cache for at most 30 seconds; Refresh bypasses caches. Exports include all matching rows up to an explicit 20,000-row safety limit, rather than silently exporting one page.

TTL applies only to batch receipts and temporary internal text-session/attempt records. Durable usage, source/provider receipts, and daily aggregates have no transcript TTL. Existing transcript permissions and retention are unchanged.

## Validation

The Firestore emulator suite includes analytics authorization, canonical draft deduplication, event replay, ownership retention, provider deduplication, UTC splits, missing historical data, internal filtering, metadata-only internal capture, telemetry failure isolation, and complete pagination/export checks. Angular tests cover navigation visibility, filter requests, stale-response protection, duration formatting, errors, and CSV formula escaping.

## Unified card and board activity

Card, board and platform reporting use the same durable verified session ledger. The card and board endpoints enrich ledger records with retained raw conversation records, deduplicating by provider conversation or source receipt. This includes internal calls and metrics whose raw transcripts have expired. Internal calls retain minimal metadata; their questions and transcripts are not copied into visitor history. Traffic and conversations now follow the same **All activity / Visitors only / Internal only** audience selection. Owner/admin board loads and card opens are recorded in separate internal shards rather than discarded. Team-level visitor reports continue to exclude internal traffic.

Verified voice seconds are split at UTC midnight; conversation counts belong to the start date. Text estimates do not contribute voice minutes. Pending sessions, unverified sessions and calls with unknown durations are reported separately. “Known participants” counts distinct recorded account/anonymous-session hashes; “Unique visitors” counts tracked browsers. Neither metric claims to count individual people. Missing browser identities are disclosed rather than invented. Last verified activity is the latest recorded verification timestamp.

`reconcileBoardAnalytics` is owner/admin only and pages through server-issued voice sessions. Existing verified receipts are enriched without fetching provider history again. Missing receipts are recovered only after verifying provider conversation, session nonce, agent and start time. Provider history that no longer exists stays unavailable. Repeated reconciliation does not duplicate activity. The end-of-call browser sync uses bounded retries; the server checks pending calls every minute and continues if the browser closes.

## Read-only report sharing

The board analytics page displays the board's saved custom URL and offers **Share report**. Only the board owner or a platform administrator can create, list or revoke report links. Creation fixes the selected 7/30/90-day UTC period and conversation audience into a timestamped snapshot, with a 7/30/90-day expiry. Reports do not update automatically. Generate a new link for refreshed results.

A report includes board title/public URL, aggregate traffic and conversation metrics, verification/coverage status, daily totals and up to 200 visible card titles with counts; truncation is disclosed. It never includes questions, transcripts, email addresses, visitor/session identities or campaign labels. Published/visible card filtering excludes author-only cards and their hidden descendants.

Access uses a cryptographically random capability in the URL fragment; only its SHA-256 hash is stored. Links use the production origin and saved slug. No sign-in is required to view a valid report. Expired/revoked links and links for deleted/transferred boards return the same unavailable response. Firestore clients cannot directly read or write grants or creation limits. Shared pages suppress workspace assistants and analytics initialization and set no-referrer, no-store and noindex policies. The fragment is never used as an analytics parameter.

Reporting integration tests verify cross-page totals, audience filtering, UTC splits, missing duration/identity handling, idempotent reconciliation, capability expiry/revocation, ownership checks and aggregate-only serialization. Browser tests verify scope requests, saved-slug links, sharing controls, stale report protection and safe rendering.

## Views and traffic audiences

A **board view** is one successful load of actual board content. Repeated hydration or canonical-URL resolution while the same board is open does not add another view. Returning after leaving the board starts a new view, including an immediate return from analytics. Analytics dashboards and shared analytics reports do not create board or card views.

A **card open** is an explicit content/conversation open or a direct QR/live-card entry after the actual card is resolved. Opening a board alone does not count every card displayed in its grid. Direct-card route reprocessing does not count the same open twice. Repeat transport delivery of an event is deduplicated by event ID.

The server determines whether traffic is internal from authenticated board ownership, platform-admin roles, team membership and (for card events) avatar-administrator permissions. A client-supplied internal flag is ignored. Internal traffic uses separate daily shards and browser-identity namespaces. **All activity** combines both audiences while deduplicating period browser identities; **Visitors only** and **Internal only** remain isolated. Private-board telemetry is accepted only for authorized internal viewers, and known automation remains excluded.

Global board views and card opens use the same recorded daily shards as board/card reporting. Separate indexed Firestore sums preserve legacy sparse counter maps; visitor totals are all traffic minus internal traffic at one read-only transaction snapshot. This avoids downloading every event or counting missing fields as missing documents. There is a bounded document-reading fallback while indexes build.

Earlier internal visits were deliberately excluded at collection time, so there is no exact historical count to restore. Conversations do not backfill fictional page views or opens. `internalTrackingStartedAt` discloses when internal traffic recording began for a board. Newly shared report snapshots record their traffic audience explicitly; pre-existing snapshots keep their original visitor-only traffic interpretation and remain immutable.

Before requesting board, card or platform reports, the client waits up to two seconds for its in-flight traffic writes. Content remains interactive while telemetry is sent. Google Analytics continues to mirror accepted visitor events only; internal activity stays in first-party reporting. The server determines the audience.
