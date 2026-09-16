# Properties preview feed

`/properties` queries `public_board_summaries` by `visibility == public` and
`is_property == true`, ordered by `created_at_iso` descending. It loads 11
previews per page instead of scanning full public boards. Card counts, search
text, likes, and responsive cover images come from the preview; opening a board
loads its full content. The in-memory cache is separate from Home/Discover and
expires after two minutes.

Properties includes the signed-in viewer's own public properties. The creator
exclusion used by Home/Discover recommendations does not apply to this directory.
Private boards remain excluded.

`syncPublicBoardSummary` maintains the classification on board writes. The
browser's fallback classifier and the Functions classifier must stay identical;
`test:public-board-summary` checks this. Author-only cards are excluded from the
public projection and classification.

When rolling this out to another environment, prepare the backend before the
frontend:

1. Deploy the `public_board_summaries` composite index in `firestore.indexes.json`
   (`visibility`, `is_property`, `created_at_iso`) and wait for it to be ready.
2. Deploy only `functions:syncPublicBoardSummary`.
3. Run `npm --prefix functions run build`, then
   `GCLOUD_PROJECT=<project> node functions/scripts/backfill-public-board-summaries.cjs --apply --skip-images`.
   This requires Firebase Admin credentials for that project. It preserves
   existing optimized covers and reads canonical boards transactionally to
   avoid publishing stale data during concurrent edits.
4. Release the frontend and verify the page, property search, and board links.

Validation:

- `npm --prefix functions run test:public-board-summary`
- `npm test -- --watch=false --browsers=ChromeHeadless --include=src/app/public-wikis/public-wikis.spec.ts`
- `./node_modules/.bin/ngc -p tsconfig.app.json --noEmit`
