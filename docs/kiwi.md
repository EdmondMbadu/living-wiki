# Kiwi account assistant

Kiwi is mounted in the app shell, so the launcher appears on desktop and mobile routes. Guests can see the mascot and sign-in prompt. Firebase Authentication is required for conversation and every server operation. The assistant name and voice are stored per user in `users/{uid}/kiwi/preferences`; they default to Kiwi and Sunny.

## Current abilities

- Choose Talk or Chat. Talk is the primary mode: on browsers with Web Speech recognition, Kiwi collects interim and final transcript segments, waits for 2.4 seconds of quiet before sending the turn, and offers an explicit **I’m done speaking** control. Kiwi then answers using ElevenLabs natural speech and listens again until the user ends the conversation. Chat offers a text composer. Proposed writes pause voice mode for on-screen review. The edit button opens a modal to rename Kiwi and choose from four previewable voices.
- Create a standard personal board or a private team draft with cards. The existing board wizard remains the path for specialized board types.
- While preparing a board request, Kiwi shows a building state. When a board proposal arrives, its card titles appear one by one; after approval, the interface shows the save and completion state before opening the board. Firestore still saves the approved board atomically, so the animation represents the visible preview and save state rather than individual database writes.
- Redesign an existing board, edit its title/description/tone, and add, edit, remove, or reorder cards.
- Copy another person's public personal board into the signed-in user's account before editing it. This copies public text and HTTPS images, excluding author-only cards and private metadata.
- Prepare an email of the user's own Public or Unlisted personal board to an explicit recipient. The recipient and board appear in the review panel. Sending uses the existing email template and rate limit and requires a verified sender. Private and team boards cannot be emailed.

Every proposed change is normalized to an allowlisted action and held for 15 minutes. Kiwi shows the fields and content before the user applies it. A server transaction rechecks board ownership, plan eligibility, team membership, visibility, and revision at Apply time. Personal board and team board writes are idempotent. Team saves use the existing listing audit and revision path. Kiwi's action documents are inaccessible through client Firestore rules.

## Callable functions

| Function | Purpose |
| --- | --- |
| `kiwiPreferences` | Get or set the signed-in user's assistant name and voice. |
| `kiwiSpeak` | Generate ElevenLabs speech for a signed-in user's response or a fixed voice preview. Voice IDs are allowlisted and usage is limited per account. |
| `kiwiTalk` | Send a request with optional board/team context; receive a reply and optional reviewed proposal. |
| `kiwiApply` | Apply a board/card/copy proposal by its ID. |
| `kiwiEmail` | Send an approved board email proposal by its ID. |

The web app supplies board and team context from the current route. A future phone or ElevenLabs/OpenAI voice client should authenticate the caller to a LivingWiki account, then use the same server-side action policy and Apply step. A phone number alone must never grant board access.

## Operational notes

`kiwiTalk` uses the app's existing `GEMINI_API_KEY` Firebase secret. `kiwiSpeak` uses the existing `ELEVENLABS_API_KEY` secret and the Turbo v2.5 model. `kiwiEmail` uses the existing SendGrid secret. Deploy the new functions and hosting together; the launcher alone cannot converse until the functions are deployed. A CORS preflight failure at a Kiwi callable URL can mean that the function does not exist in the selected Firebase project. Verify the deployed function list before changing CORS settings. Verify one real signed-in conversation and one email delivery in a staging environment with configured secrets before enabling the feature in production.

New Talking Card creation entry points and automatically generated setup placeholders have been removed. Previously published Talking Cards remain readable and editable for compatibility. Browser speech recognition support varies by browser; typed conversation is always available. Audio is returned to the authenticated client for local playback and is cancelled when the user ends the conversation or closes Kiwi.
