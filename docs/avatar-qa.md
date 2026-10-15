# Avatar QA

The QA control beside a Talking Card’s action menu opens
`/manage/boards/:boardId/cards/:cardId/qa`. The page reuses the shared workspace
sidebar, mobile navigation, theme control, crane mark, and LivingWiki brand asset.

## First release scope

- English visitor text conversations against the existing public answer pipeline.
- Author-managed answer library, JSON import, and extraction from indexed documents.
- Exact answer matching (outer whitespace ignored), with internet fallback flagged.
- Up to 100 independent scenarios, each with up to four follow-up turns.
- Durable background execution, cancellation, timeout recovery, configuration
  fingerprints, transcripts, citation evidence, append-only review, JSON/CSV export.
- No fabricated demonstration metrics. Empty and unavailable states are explicit.

Voice, translated conversations, team boards, property guides with injected
listing context, semantic grading, and independent clinical routing evaluation
are outside this release. Do not interpret text results as voice validation.
Critical labels conservatively flag urgent/emergency reference mismatches; a
human must determine clinical significance. There is no automatic publishing or
regulatory approval action.

## Access and data

The avatar owner and assigned avatar administrators may use QA on accessible
standard boards. Public board visibility alone does not grant QA access. Every
call verifies the current board/card/avatar relationship and administrator
assignment. Team and listing-context targets are rejected explicitly.

All client reads and writes to QA collections are denied by the existing default
Firestore rules. The authenticated callable exposes authorized operations only:
`load`, `save`, `importDocument`, `start`, `cancel`, `review`, `export`.

- `avatar_qa_workspaces`: versioned library and active-run binding.
- `avatar_qa_runs`: preserved execution metadata, references, progress, and counters.
- Run subcollections `cases`, `results`, `reviews`: independent work items,
  immutable results, and append-only reviewer decisions.
- `avatar_qa_quotas`: maximum ten run starts per initiating user per UTC day.
- Private Storage `avatar-qa/.../configuration.json`: creation-only runtime and
  source snapshot. No public URLs or client access are granted.

Source-document extraction is an AI-assisted draft operation. Each extracted
answer must be found in the original source after whitespace normalization. No
approval status is inferred: an owner must review entries and supply documented
approval metadata. Manual entries require a source and version.

The server-only `qaSandbox` option in `runPublicAtlasQuery` uses isolated history
and captures the observed answer path, without writing visitor threads, messages,
or analytics. Public callable handlers do not accept this option. Expected answers
are sent only to the grader, never to the avatar.

The existing legacy topic retriever is owner-scoped. Snapshots retain hashes of
that owner-scoped retrieval data, while exporting source content only for the
selected avatar. Changes in those hashes conservatively require retesting.
Provider/model aliases can change externally; exact replay is not guaranteed.
Bump `QA_PROTOCOL_VERSION` when changing the grader or relevant runtime behavior.

Completed execution records are immutable. Reviews do not change pass/fail
counters. Queued cases cancel immediately; in-flight turns are retained and stop
before their next turn. Scheduled recovery records timeouts as errors, rather
than silently retrying and concealing failures. New explicit runs preserve prior
attempts. Snapshots exceeding the pilot corpus/export limits produce a clear
error. History shows the latest 30 runs; older run IDs remain directly loadable.

## Verification

```sh
npm --prefix functions run test:avatar-qa
npm run test:firestore-rules
npx ng test --watch=false --browsers=ChromeHeadless \
  --include='src/app/avatar-qa/*.spec.ts' \
  --include='src/app/talking-card-conversation/*.spec.ts' \
  --include='src/app/workspace-sidebar/*.spec.ts' \
  --include='src/app/workspace-navigation/*.spec.ts' \
  --include='src/app/boards/talking-card*.spec.ts'
npm run build:hosting
```

Integration tests use the Firestore emulator and fake provider responses/storage.
They never call a live model, send emails, or alter production avatar settings.

## Deployment

Deploy the new Firestore composite index before enabling the UI. The three new
functions are `avatarQaCommand`, `runAvatarQaCase`, and `recoverAvatarQaCases`.
They use the existing Gemini secret and application Storage bucket. Deploy the
updated Hosting bundle after the index and functions are ready. No changes to
public conversation policy or existing voice-agent configuration are made.
