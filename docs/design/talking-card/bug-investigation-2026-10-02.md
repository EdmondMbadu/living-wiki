# Talking Card save and avatar visibility investigation

The supplied screenshot comes from the final board-persistence step, not the Word document upload step. `TalkingCardEditorComponent.save` creates the avatar, uploads its portrait/voice/documents, then emits a result. `BoardsComponent.persistTalkingCardAndFinish` saves the card to the board. The exact screenshot text was the generic fallback in that final handler.

Jim's board, its visibility, account plan, and actual Firebase exception were not available. His specific cause is therefore unconfirmed. No production data was changed and no deployment was performed.

## Reproduced failures

1. **Publication gate:** the editor required the publication checkbox for Public boards. Separately, board save validation rejected private avatars on both Public and Unlisted boards. This both conflated board conversation access with directory publication and let Unlisted users reach a late failure.
2. **Historical board fields:** both Studio card-update rule branches revalidated unchanged title, description, and cover fields. An existing description longer than 240 characters or title longer than 90 could prevent adding a Talking Card. A controlled Firestore emulator comparison confirmed that the original rules reject a card-only update to a legacy walking tour and the fixed rules accept the identical update. On rejection, the old rules also fall through enough alternatives to exhaust Firestore's expression budget.
3. **Hidden cause:** the modal replaced the specific error recorded by the board save with “Check your connection.” Ownership, expired sessions, quotas, privacy preflight failures, and rule denials were indistinguishable there.
4. **Retry duplication:** documents remained pending after successful upload, so retrying a failed final board write uploaded them again. Successful uploads are now removed from the persisted pending-file draft.

A small Word document can therefore coincide with this failure without causing it. Document contents are uploaded separately; the board card contains an avatar ID and presentation/conversation settings.

## Changes

- Directory publication is optional for new and owned private avatars, on every board visibility. It remains an explicit choice, reset on draft restoration.
- Shared boards can use an avatar owned by the same person without changing `is_public`.
- A server helper checks the stored board owner, board visibility, matching visible Talking Card, and avatar ID before permitting visitor access. Nested cards are supported; hidden parents/cards, forged IDs, unrelated owners, private boards, and team boards do not grant personal-board visitor access.
- A callable returns presentation fields only. Private atlas documents remain unreadable and unqueryable through Firestore. The directory still queries public atlases only.
- Text questions, voice-session creation, and Talking Card recaps use the same access helper. Existing team voice checks remain in place.
- Board titles now support 240 characters (previously 90); descriptions support 5,000 (previously 240). The board editors, normalization, Firebase rules, nested board-title metadata, board copies, Kiwi edits, and team title saves use the expanded limits. Shared JSON constants and a rule synchronization test prevent drift.
- Card updates validate changed title/description/cover fields. Unchanged historical text beyond even the expanded limits still does not block adding a Talking Card. Ownership checks, plan gates, card-count limits, and media invalidation requirements remain in effect.
- The modal preserves the actual board-save error and its draft.
- UI changes are limited to visibility wording and matching title/description input limits. The generated modal layout is a proposal, not an implemented redesign.

## Verification

- 93 targeted ChromeHeadless browser tests passed.
- Updated full Firebase emulator regression suite: 149 tests passed, including successful creation, Studio saves, detail edits, and Talking Card saves at the expanded title/description limits for Public, Unlisted, and Private standard boards and walking tours, plus a team listing with long text.
- Additional targeted access/endpoint suite: 16 tests passed (14 overlap the full suite, plus 2 new text/voice endpoint tests). Provider calls were mocked; no live voice provider was contacted.
- Original-versus-fixed rules comparison: original card-only legacy walking-tour save denied; identical fixed save accepted.
- Functions TypeScript build and translation catalog checks passed.
- 30 additional targeted browser tests passed for board text normalization, copying, Studio persistence, and Talking Card saves.
- Kiwi policy tests passed with long create/edit/design text.
- Angular development build passed.

No live Jim-session reproduction or live microphone/provider test was possible from the supplied evidence.

## Release requirements

Deploy the rules, functions (`getTalkingCardAvatar`, `askPublicAtlas`, `createElevenLabsVoiceSession`, `sendVoiceConversationSummary`, `teamCommand`, `kiwiApply`, `kiwiTalk`), and hosting together. In particular, deploying the frontend alone would remove the publication gate without providing the new visitor access endpoint. Then verify an owned private avatar on Public, Unlisted, and Private boards with a small DOCX and a visitor session. Shared voice-agent tools that make independent public-wiki requests need to supply the board/card context to the chat endpoint for a private avatar; the session now supplies `board_id` and `card_id` dynamic variables.


## Application limits versus Firebase quotas

The previous 90/240-character limits were our validators, not Firebase storage quotas. Firebase's [official quota documentation](https://firebase.google.com/docs/firestore/quotas) specifies a 1 MiB document cap and a 1,000-expression security-rule evaluation cap. Neither is raised by changing app limits. The added tests exercise actual successful emulator writes rather than just checking error messages. Word documents remain separate uploads and are not embedded in the board title/description.
