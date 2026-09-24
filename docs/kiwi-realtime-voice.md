# Kiwi realtime voice

Kiwi uses its own ElevenLabs agent (`agent_7401m3a84gbde8hvd5emmmnckexw`). It is separate from the shared Talking Card agent. The Firebase callable `kiwiVoiceSession` issues a short-lived signed WebSocket URL to a signed-in user. The browser keeps one `@elevenlabs/client` voice conversation open and sends the saved assistant name and voice preference into that session.

The agent has two client tools:

- `kiwi_request` (`tool_3801m3a84g4tegda4tbqv7n6zfbj`) starts an authenticated `kiwiTalk` request without waiting for board generation. It asks for visibility before starting a personal board.
- `kiwi_apply` (`tool_9001m3a84g8qe4rrftexfgvhf2hs`) applies a ready proposal only after a later, explicit user approval. The browser calls the existing authenticated `kiwiApply` function; ownership and team rules remain on the server.

The voice connection stays active while `kiwiTalk` streams a visible board draft. `kiwiTalk` stores a pending proposal; nothing is written to a board until `kiwiApply` runs. Chat mode continues to use `kiwiTalk` directly. Voice choice previews still use `kiwiSpeak`.

For new boards, Kiwi defaults to **Describe it** and asks for a subject when none is supplied. The draft shows its cards as they stream in. It searches for relevant card images using the existing board image search and creates labeled original illustrations through `generateBoardCardImage` when a match is unavailable. At most six missing images are generated automatically; users can retry individual cards. The Create button waits for image processing and requires at least one image. Generated images are uploaded under the signed-in user's board media path on approval, then `kiwiApply` stores their URLs in the board and card records. Empty card lists are rejected server-side. Real estate requests open the listing wizard for source URLs and real property photos; More board types opens the existing wizard.

Production Firebase needs `ELEVENLABS_KIWI_AGENT_ID` set to the agent ID above and the existing `ELEVENLABS_API_KEY` secret. `functions/.env.living-atlas-7622a` is ignored by Git and has the production agent ID on the deployment host.

For a text-only live agent check, pipe the existing ElevenLabs key to `KIWI_AGENT_ID=agent_7401m3a84gbde8hvd5emmmnckexw node scripts/test-kiwi-voice-agent.mjs`. This checks tool invocation and the agent response without microphone access or board writes. A signed-in browser test should confirm that a requested private board shows Private immediately, fills its cards, and remains a proposal until Create board is selected.
