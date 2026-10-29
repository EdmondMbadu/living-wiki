# Platform analytics

`/admin/analytics` is accessible from Users and the admin account menu. The Angular admin guard controls navigation; each callable independently verifies `users/{uid}.role == 'admin'`. All platform analytics collections deny direct Firestore client access.

## Metric definitions

- **Boards / cards / talking cards:** current saved inventory, including private boards and drafts. A team board's working draft and published copy share one canonical board ID. Cards are deduplicated by ID within a board, including related cards. Talking cards require an Atlas conversation configuration and count placements, not distinct avatars.
- **Boards created over time:** boards whose saved creation timestamp falls within the selected UTC date range, grouped by day, month, or year. `platform_analytics_board_creations` keeps one minimal record per canonical board ID after deletion. Drafts and published copies count once. The earliest valid saved timestamp is retained; analytics import/edit times are never substituted. Missing, invalid, and future dates are excluded and disclosed. Earlier deleted boards that left no surviving record cannot be reconstructed. This chart covers all owners and is independent of the internal-conversation toggle and breakdown search.
- **Conversations:** a scoped text session or verified provider voice session with at least one user message. Greeting-only calls do not count. Automated QA has no card-session attribution and stays separate. Owners, avatar administrators, platform admins, and team members are internal sessions, excluded by default.
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
