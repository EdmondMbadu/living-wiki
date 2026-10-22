# German and Simplified Chinese support

This phase adds German (`de`, `/de/`) and Simplified Chinese (`zh-Hans`, `/zh/`) alongside the five existing site locales. Board translation and narration APIs use `de` and `zh`; Chinese narration targets Mandarin (`zh-CN`), rather than Cantonese.

## Included

- Complete Angular JSON catalogs, localized production/development builds, and native names in the existing site and board language menus.
- Locale persistence and route replacement, including region/script aliases such as `de-DE`, `zh-CN`, and `zh-Hans`.
- Firebase Hosting and local-server locale roots, CSR deep links, and equivalent caching headers.
- Board translation prompts/validation and language-aware audio/cache handling.
- German/Mandarin narrator selection using verified language metadata and browser narration fallback. Unsupported voices remain unavailable instead of silently speaking English.
- Talking Card text/voice language instructions, localized default actions, and unavailable-language messages.
- Tour handoff narration and the corresponding server-side approved-text generation.
- Public card/board sharing language parameters, and the live verification script's language allowlist.
- Picamo's locale recognition, generated text/voice language instructions, fixed replies, and action preview summaries/details.

Chinese Han characters no longer automatically identify a board as Japanese; Japanese kana take precedence. The source-language detector remains heuristic, particularly for short names. Translation schema/fingerprints advance to version 3 so old misclassified overlays are not reused. Deploy frontend and affected backend functions together.

The approved first-visit visitor chooser, replacement Live toolbar globe, background language preparation, per-card on-demand translation, and streaming latency improvements remain the next phase. This change uses the existing selectors and translation/playback architecture.

## Catalog workflow

Both new catalogs contain the same IDs and ordered placeholders as the English source. They were generated locally with the existing Argos workflow, then corrected with shared product terminology, primary UI labels, and explicit homepage/legal translations. They are not represented as professionally reviewed translations of every message.

Reviewed overrides live in `scripts/locale-overrides.de-zh.json` and `MANUAL_OVERRIDES` in `scripts/translate-angular-catalog.py`. Regeneration reapplies corrections, preserves HTML/icon placeholders, and protects product names. The optional `--batch` mode runs installed Argos models directly, avoiding legacy Stanza tokenizer incompatibilities. Install the Argos en→de and en→zh models before generating missing translations.

```sh
python scripts/translate-angular-catalog.py de --batch
python scripts/translate-angular-catalog.py zh-Hans --batch
npm run i18n:check
```

## Verification

```sh
npm run test:languages
npm --prefix functions run build
node functions/scripts/test-board-translation.cjs
node functions/scripts/test-native-voice.cjs
node functions/scripts/test-agent-language.cjs
node functions/scripts/test-tour-handoff.cjs
node functions/scripts/test-kiwi-policy.cjs
node --test scripts/prepare-hosting-runtime-config.test.mjs
npm run build:hosting
```

`test:languages` uses a focused TS configuration with the actual application declaration files. This avoids unrelated missing avatar-QA JSON fixtures in the broad test compilation, while testing routing, board overlays/playback, QR links, Talking Cards, and narrator/handoff behavior.

For browser inspection, serve the production output with `node scripts/serve-localized.mjs`; inspect `/de/`, `/zh/`, and localized board routes. A board link with `contentLang=original` verifies localized controls without requesting a production translation.

Verification completed locally: all six translated catalogs pass the 6,655-message completeness/placeholder check, all 77 focused browser tests pass, backend language/voice/Picamo checks pass, and the full seven-language Hosting build succeeds. German desktop and Chinese mobile controls were also inspected in Chrome. Existing Angular CSS-budget and CommonJS warnings remain.

## Live service verification after deployment

Production functions, ElevenLabs account voices, and agent settings were not changed by this local implementation. A compatible verified narrator is required for each spoken language. Interactive Talking Card voice sessions additionally require the shared agent's language presets and language/voice overrides to be enabled for `de` and `zh`, under the same existing readiness checks as French and Japanese.

After deploying the affected functions and Hosting, run the existing verification script against an approved public test board with the last argument `de,zh`. It checks actual translation and ElevenLabs MP3 generation/download and may consume provider credits:

```sh
node scripts/verify-board-language-live.mjs PUBLIC_TEST_BOARD_ID /tmp/livingwiki-de-zh-report.json de,zh
```

No deployment or live provider generation was performed in this phase. Local tests and browser inspection cannot certify account-specific voice availability or measured production latency.
