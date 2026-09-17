The generation and script-shortening fixes are implemented locally. This is the implementation record for `board-copy-quality-plan-2026-09-16.md`; the original diagnosis describes the code before these changes. No deployment or production content write has been performed.

**Generation**

The listing writer now receives the final overview, room groups, and closing card before writing. Every response must match its card key, role, and selected presentation photographs. The schema and validator share their role vocabulary, including aliases for the exact role names in the reported incident. The story cache version is now `listing-story-v3-group-copy`, so rejected legacy plans are not reused.

Missing or rejected scenes receive one bounded regeneration attempt, then complete factual fallback sentences based on the pictured space. Overview and closing copy have their own construction paths. Internal directions and photo-classification review messages no longer become public narration. Rejection reasons and fallback counts are logged without logging the source copy.

The writing brief favors specific observed features, limits inclusion claims, avoids inferred room connections and universal claims about every bedroom, and checks bed/bath quantities against their corresponding fields. Five-second mode requests one complete sentence. Sparse evidence is not padded to fill the requested duration. Descriptions retain more source material internally, and deterministic style handling no longer invents first-person introductions.

A common check runs after final source shaping, before wizard output is returned. It checks public copy for known instructions, missing or incomplete narration, dangling clauses, and duplicate scripts. It repairs defective cards once, then rechecks the result. If a card still cannot be completed, generation returns an explicit error naming affected cards instead of returning defective copy as ready. Author-supplied intros, source-authoritative pasted text, and author-only setup cards retain their intentional behavior.

**Shortening and persistence**

Browser and backend now use the same pure sentence-handling code. The 1/2/3-sentence choices use complete sentences, with a local fallback if the rewrite service fails. Duration is a soft target: an intact sentence and an important qualification take precedence over an exact word count. Qualified and negative claims are retained; multiple qualifications can be joined with semicolons. English, French, and Japanese regression cases are covered. This is a conservative check, not a general semantic proof for every language.

Numerical additions, known fragments, missing results, and duplicate response IDs cause a per-card fallback. A board with more than 50 cards retains every card; only the model request is limited to 50. Oversized requests preserve the original text and use the local adjustment path. The approved full script is stored without the old 3,000-character slice and restored by the Firestore record reader, enabling shorten → save → reopen → expand. An explicit manual edit becomes the new approved source, so expanding cannot revive removed claims.

The editor prevents saves during a pending adjustment. A late model response cannot overwrite a manual change or a later editor session. Repeated no-op adjustments retain undo, and failed saves retain the draft. Contact data is stored independently, preserving Call and Email actions. Tour narration and contact scripts use a shared narration resolver. Script saves invalidate both video orientations, both trailer orientations, their local file caches, and audio revisions. Translations include explicit contact scripts and omit author-only reminders.

**Existing-board repair**

`functions/scripts/repair-board-copy.cjs` defaults to a read-only scan of one explicit board ID. It writes a private proposal file containing the original snapshot and fingerprint. It targets the known generated instructions and broken fallback signatures, leaving ordinary authored fragments and introductions alone.

```sh
npm --prefix functions run build
GCLOUD_PROJECT=living-atlas-7622a node functions/scripts/repair-board-copy.cjs \
  --team-board f0f38e0d-c50d-4d16-a4d8-d18cdce1cf3d \
  --out /private/tmp/board-copy-review.json
```

Optional `--replacements <file>` takes an array of `{ "cardId": "…", "narration": "Finished reviewed copy." }`. Applying a reviewed proposal requires explicit `--apply <proposal>` and `--as-user <active-team-member-uid>`. It uses the existing team save transaction, membership checks, revision history, and idempotency. The transaction requires the exact reviewed revision; a changed board must be rescanned. It retains IDs, photos, team ownership, privacy, publication state, and unaffected cards. Personal boards currently support scanning only.

The reported team draft was scanned at revision 1. Six affected cards were found. A proposed replacement set and recoverable snapshot are saved at `/private/tmp/livingwiki-copy-repair-proposal-20260916.json`; this file has not been applied. The proposed wording uses the saved feature labels and avoids the unresolved property-type discrepancy. A photo review remains appropriate before applying it.

| Card | Proposed narration |
| --- | --- |
| Overview | Explore the property at 836 1st #2 in Ocean City, New Jersey. |
| Living Areas | Hardwood flooring and a vaulted ceiling define the pictured living area. |
| Kitchen | White cabinetry and hardwood flooring give the kitchen a cohesive palette. |
| Dining Areas | A vaulted ceiling rises above the pictured dining area. |
| More Spaces | A louvered bifold door is visible in one of the additional spaces. |
| Outdoor Spaces & Views | The outdoor photographs offer additional views of the property. |

**Validation and rollout**

The focused backend command is `npm --prefix functions run test:board-copy`; repair tests use `npm --prefix functions run test:board-copy-repair`. Tests cover 30 combinations of listing scene targets and durations, the observed legacy roles, photo membership, qualifications, response failures, source persistence, contact actions, and stale repair proposals. Existing listing, narration, wizard quality, commerce, menu, article, translation, document export, and team suites also passed.

The focused Chrome suite passed 63 tests across script persistence/shortening, malformed rewrite responses, contact cards, translations, document export, presentation photos, author-only visibility, and video export. The production hosting build, complete French/Japanese translation checks, and bundle performance checks passed. Existing CSS-size and CommonJS optimization warnings remain.

An opt-in live check is available as `npm --prefix functions run eval:board-copy:live` with `GEMINI_API_KEY` supplied through the environment. It uses synthetic evidence and never writes boards. A successful run returned all 11 planned listing cards, retained all 11 writer narrations, preserved exclusions during one-sentence shortening, and repaired a general museum card. The three requests took approximately nine seconds in that run; this is a smoke check, not a latency distribution or a blind editorial benchmark.

The wider roadmap still includes a larger independently reviewed quality corpus, semantic claim verification against a richer evidence model, extraction conflict resolution, explicit fixed-count group merging, and a production canary. This change preserves the existing room-coverage behavior and reports the actual resolved card count. It does not claim that deterministic checks can establish every factual statement or resolve contradictory source data. Deployment and application of reviewed repairs are separate release actions.
