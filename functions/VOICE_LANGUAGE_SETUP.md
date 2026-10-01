# Live and Talking Card voice languages

The website supports English, French (`fr-FR`), Japanese (`ja-JP`), and Brazilian Portuguese (`pt-BR`). Live narration uses `eleven_multilingual_v2` and chooses an ElevenLabs voice whose `verified_languages` includes the requested locale or native regional accent. The Talking Card agent uses the same voice check and sends both a language override and a voice override before the conversation begins. If either voice is unavailable, the translated card stays readable and the app does not substitute an English voice.

To enable translated Talking Card conversations in the production ElevenLabs agent referenced by `ELEVENLABS_AGENT_ID`:

1. Add French (`fr`), Japanese (`ja`), and Portuguese (`pt`) under **Agent → Additional Languages**. Review each language's first message and choose an appropriate multilingual TTS model.
2. Under **Security → Overrides**, enable **Language** and **Voice ID**. The function checks both settings before it issues a conversation credential.
3. Make a native voice for each region available in the same ElevenLabs account. Its `verified_languages` must identify France, Japan, or Brazil, respectively. The function lists the account's available voices and checks `verified_languages` at runtime, then caches successful matches for six hours. Do not filter the `/v2/voices` lookup by `language` or text search: those filters use the voice's primary label and can hide voices with verified French, Japanese, or Portuguese samples. Live narration also requires the verified sample to support `eleven_multilingual_v2`.
4. In the Firebase Functions environment, set `ELEVENLABS_LANGUAGE_OVERRIDES_ENABLED=true` and `ELEVENLABS_TTS_VOICE_OVERRIDES_ENABLED=true`. Keep `ELEVENLABS_FIRST_MESSAGE_OVERRIDES_ENABLED=false` unless the agent's Security settings also allow a first-message override. The local project `.env` is gitignored, so each deployment environment needs these settings independently.

Deploy the changed functions and Hosting after building. The changed callables are `createElevenLabsVoiceSession` and `synthesizeChatAnswerSpeech`.

Verify on a translated board: play a middle Live card, then open a Talking Card and start a conversation. Check the spoken language, pronunciation, and first greeting for `fr`, `ja`, and `pt`; then verify English still works. If a language is not configured, the voice flow should show an error while text chat remains available.

ElevenLabs documents [additional languages and language-specific voices](https://elevenlabs.io/docs/eleven-agents/customization/voice/customization/language), [conversation override permissions](https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides), and [verified voice metadata](https://elevenlabs.io/docs/api-reference/voices/search).
