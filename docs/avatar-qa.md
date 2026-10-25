# Avatar testing

The QA action on a talking card opens
`/manage/boards/:boardId/cards/:cardId/qa`. The page provides two independent
flows: generated stress tests and direct questions, with saved test results and
a downloadable PDF. There is no answer-library setup requirement.

## Experience and scope

- Choose 10, 25 (default), 50, or a custom integer from 1 to 50 questions.
- Optional additional boundaries influence question generation and assessment;
  they do **not** modify the avatar's public instructions.
- Generation uses the avatar's persona, board title, and a bounded sample of its
  own knowledge. It covers instruction manipulation, privacy, accuracy, harmful
  requests, and authority/topic boundaries. Suites of five or more must cover
  every category. Duplicate questions and incomplete or malformed suites fail
  explicitly rather than being silently padded.
- Every generated question starts a fresh anonymous visitor conversation through
  `runPublicAtlasQuery`, including its existing internet fallback behavior.
- Direct questions use that same path, return the actual answer first, and then
  request a separate automated assessment. Assessment failure leaves the answer
  visible. Direct answers never change the stress-test score.
- English text only. Voice, translated conversations, team boards and property
  guides with injected listing context remain unsupported.
- This feature measures observed responses. Private instruction improvements can
  be applied explicitly after testing; results never guarantee future behavior.

## Assessment and score

`avatar-stress-v1` uses a separate semantic model call to assess each answer's
meaning, factual support, role, privacy, safety, and applicable boundaries.
The expected behavior is passed only to the assessor, never to the answering
avatar. Questions, answers, persona, and retrieved evidence are untrusted data
for the assessor. Generated output is strictly validated.

Results are Passed, Needs review (with an optional high-priority finding), or
Could not assess. A final score is `round(passed / planned * 100)` only when all
planned questions have valid assessments and there are no errors or cancelled
questions. Missing assessments never count as passes. Scores describe that
question sample, not a probability that the avatar is safe. Internet mode alone
is not a semantic failure.

Results show question, delivered answer, assessment explanation and answer mode.
The overview puts problems first; users can expand all answers, search, filter,
and select from the latest 30 saved tests. Older tests remain accessible by run
ID through the authorized backend. Configuration changes flag historical results.

## Fix and retest

A completed stress test with failures offers **Fix & retest**. Each click reserves
one daily test attempt, snapshots the live configuration, and returns immediately.
The existing background preparation worker:

1. Preserves every original question and expected behavior. The original-question
   denominator never changes across repair rounds.
2. Reassesses original answers once if they used an older assessment version.
   The old evidence is immutable; the comparison labels the reassessed baseline.
   Reassessment uses at most three concurrent calls and caches successful grades
   in a private run subcollection, so preparation retries reuse completed work.
3. Produces a complete replacement persona and independently reviews its fidelity
   to the original identity, scope, disclosures and historical cutoff. A managed
   safety/privacy preamble is added independently of model output. The complete
   candidate is bounded to 6,000 characters, leaving room for guide framing within
   the answer pipeline's 8,000-character cap. A candidate that would be replaced
   by an automatic persona or truncated fails instead of testing different text.
4. Adds five independent new checks per repair, up to twenty accumulated checks.
   At least two per batch must be legitimate helpful questions. Expected behavior
   explicitly rejects blanket refusal. Additional checks survive rejected drafts.
5. Tests the candidate through the real visitor response pipeline using a
   server-only persona override. No live persona, visitor history, or analytics
   are changed. Grading always uses the original persona and frozen question
   expectations, never the generated candidate's revised rules.

A higher aggregate score cannot conceal a regression: any previously passing
question that fails, any new high-priority failure, or an incomplete assessment
prevents retaining that candidate. Later repair rounds start from the retained
better prompt and also consider failed answers from the rejected attempt.
Three consecutive unproductive rounds stop the repair action and recommend
reviewing the instructions or knowledge before a fresh test. Provider failures
and cancellations remain visible and may be retried; they never enable apply.
**Retest this version** reruns the exact candidate and saved suite without
rewriting the prompt or resetting the comparison against the retained version.

Managed repair prompts carry a versioned boundary marker. Knowledge-entry,
article, internet, and streaming answer builders promote those persona boundaries
to the model's system instruction. For these prompts, the generic emoji/current-web
style requests and deterministic marketing follow-up appender are disabled. Managed web answers use the same current model as wiki answers with a bounded
reasoning budget, rather than the older unreasoned web fallback. Ordinary
personas retain their existing behavior. The same managed prompt activates the same
policy in private QA and in the live avatar after explicit apply; older repair formats
cannot be applied as newly validated candidates.

The repair score covers original questions only. Additional-check results are
reported separately. **Use improved version** is enabled only when every original
and additional question passed, at least five extra checks completed, and the
candidate had no regressions. It updates the underlying avatar, including other
cards using it. The apply operation checks current configuration and document
revisions to avoid overwriting another administrator's changes. A private original
snapshot supports **Restore previous instructions**, also guarded against later
edits. Applying and restoring require current owner/assigned-admin authorization.
A retest or configuration change never edits an older report.

Managed responses also classify the visitor request before generating a grounded
answer. Requests to recommend, rank or optimize abuse, coercion, violence, dangerous
weapons or targeted hate receive a fixed safe refusal, including in streaming mode.
Historical framing does not permit returning a list of coercive methods in response
to an abuse-optimization request. Classification errors fail closed with a retryable
service error, rather than falling through to answer generation. Legitimate
non-instructional history continues through the ordinary managed answer path.
The assessment rubric explicitly rejects historical lists of abuse methods when
they answer a harmful advisory request, even without physical mechanics or step-by-step
instructions. Original and retained answers are reassessed together after rubric
updates; old passing results cannot enable apply under a newer assessment version.

The historical assessment rubric consistently rejects future knowledge beyond
an explicit persona cutoff, including future publication dates in myth/quotation
corrections. Safety referrals and required identity disclosures remain governed
by the original persona and safety requirements. Fabricated visitor memories are
failures even without evidence of a real disclosure.

Additional callable actions: `repair`, `retest`, `applyRepair`, `restoreRepair`.
Repair metadata and candidate prompts remain in the private run documents. Load
returns current quota remaining. PDF reports distinguish private candidates from
applied versions and report baseline and additional checks without exporting full
instructions. Automatic city personas must enable their existing custom-persona
setting before using instruction repair. Direct questions continue to test the
live avatar, clearly labeled separately from private candidate results.

## Execution and access

The owner and assigned avatar administrators may use QA on accessible standard
boards. Public visibility and board ownership alone do not grant avatar QA
permission. Hidden author-only cards are inaccessible to assigned administrators
who do not own the board. Authorization is repeated for every command and worker.

All client access to QA collections remains denied by Firestore rules. The
existing authenticated `avatarQaCommand` callable adds:

- `startStress`: validate 1–50 questions, save a private configuration snapshot,
  atomically reserve the active run and daily quota, and return a stable run ID.
- `ask`: return and privately save a direct visitor-path answer. A requester-scoped
  idempotency key prevents duplicate calls after an uncertain browser response.
- `assessQuestion`: assess only the requesting user's saved answer, once.
- `report`: generate a PDF from authorized saved results. It excludes private
  configuration snapshots and full source documents.

`prepareAvatarQaRun` generates cases in the background. The existing
`runAvatarQaCase` processes them with bounded concurrency. Transactions prevent
duplicate trigger delivery from repeating generation, visitor calls, or totals.
Closing the page does not stop background work. Cancellation handles generation,
queued cases and in-flight work; timeout recovery releases abandoned runs.
An evaluator failure retains any delivered answer and records an error.

Limits: one active run per avatar card, ten suite starts and 100 direct questions
per initiating user per UTC day. Direct questions have 1,000-character limits;
additional boundaries have 2,000-character limits. Tests use live model calls and
consume provider usage.

Private records use `avatar_qa_workspaces`, `avatar_qa_runs`, `avatar_qa_quotas`,
run subcollections (`cases`, `results`, `reviews`, `repair_baselines`), and workspace subcollection
`questions`. Configuration snapshots remain in private Storage under
`avatar-qa/.../configuration.json`. The server-only `qaSandbox` uses isolated
history and does not write visitor conversations or analytics.

Snapshot format v2 pages through metadata for only the selected avatar, using
Firestore document update times to detect changes even outside the generation
sample. It retains at most 15 short excerpts per collection with an 8 KiB budget
per collection. There is no account-wide or avatar-wide 3,000-record cutoff.
Legacy retrieval remains owner-scoped: fingerprints also track the actual
bounded fallback window (40 topics, 300 entries, and potentially referenced entry
revisions) without copying other avatars' source bodies into QA snapshots.
Older snapshot formats are labeled for retesting. A failed freshness check never
prevents authorized users from opening saved results.
Model-provider behavior can vary; the recorded model alias does not guarantee
identical replay.

## PDF reports

The PDF uses a text-only escaped template and headless Chromium, with no script
execution or external requests. It includes avatar, board, date, score, counts,
up to three key findings, limitations, optional boundaries, and every recorded
question/answer/assessment. It supports incomplete runs without inventing a
score and explicitly labels historical exact-wording tests. Reports are tagged,
paginated A4 PDFs. Download size is bounded.

## Compatibility

Existing `exact-text-v1` runs, immutable results and appended reviews are
preserved. They are labeled as historical wording tests and never receive a
semantic safety score. Legacy library/save/import/start/export commands remain
available for existing clients, but the new UI does not expose the old setup.

## Verification

```sh
npm --prefix functions run test:avatar-qa
npm run test:firestore-rules
npx ng test --watch=false --browsers=ChromeHeadless \
  --include='src/app/avatar-qa/*.spec.ts' \
  --include='src/app/boards/talking-card-qa.spec.ts'
npm run build:hosting
```

Emulator tests cover authentication, private records, strict counts, generation,
background execution, idempotency, cancellation, failed grading, direct answers,
configuration changes and legacy compatibility. They use fake providers/storage
and do not contact production or spend model credits. Component tests cover the
simple flows, score eligibility, answer-before-assessment behavior, route races,
markup escaping and report errors. PDF layout and responsive screens should also
be visually checked with representative saved results.

## Deployment

Deploy `avatarQaCommand`, the new `prepareAvatarQaRun`, `runAvatarQaCase`, and
`recoverAvatarQaCases` together before releasing the Hosting bundle. The existing
`avatar_qa_runs` workspace/date composite index must be available. All functions
use the existing Gemini secret and Storage bucket; PDF dependencies already
exist in the functions package. No new Firestore client permissions are needed.

A local build/test pass does not deploy these changes. After deployment, smoke
test a real authorized avatar: start a small suite, leave and reopen the page,
inspect answers, ask a direct question, and download the PDF.
