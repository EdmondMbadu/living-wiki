# Real estate Live contact ending

Real estate Live views retain the original contact card and its original saved narration. After that card finishes, playback advances to a separate, silent completion screen. Call and Email appear again as the primary actions; Watch again and Return to board are secondary. LivingWiki branding stays in a small footer. Playback stops on this final screen indefinitely.

## Scope and fallback

- Only direct Live views recognized as real estate TalkThrus use this ending.
- Use the last usable published contact card in the Live sequence. Exclude author-only setup cards and show only available contact methods.
- Keep every ordinary card and its narration in the original order. Attach only contact display data to the existing closing frame. The closing frame has a separate identity and never supplies a narration script or requests audio.
- Preserve the actual board cards, contact metadata, script editing, Studio selection, and exported video/document sequences.
- General and rental boards retain their existing endings. Real estate boards without usable contact information also retain the standard ending.
- Narration and contact information remain separate. A shortened or empty script cannot remove saved phone/email actions.
- On short viewports, hide the decorative photo to leave room for all actions. The ending can scroll if unusually long content still exceeds available space.

## Automated verification

50 focused ChromeHeadless tests pass across contact ending selection/rendering/playback, existing contact parsing, real estate Talking Card placement, story frame sequencing, finite playback, and script shortening/save/translation persistence.

Playback regressions exercise:

- Narrating the saved shortened contact script on the original card, then advancing to the silent final screen and stopping without a timer or restart.
- Never treating the repeated contact buttons as a script or requesting audio on the final screen.
- Completely empty narration, unavailable audio, browser speech completion, and media failure after playback starts.
- Replay while the original contact card's audio request is pending; late audio cannot interrupt the restarted cover.
- Previous/next navigation with stale completion callbacks.
- Closing Live view while audio is pending.

Component tests check correct tel/mailto destinations, missing phone/email, text escaping, and replay/return outputs. Selection tests cover legacy contact metadata, author-only exclusion, and unchanged non-Live sequences.

Command:

```sh
CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npx ng test --watch=false --browsers=ChromeHeadless --include='src/app/boards/listing-live-*.spec.ts' --include='src/app/boards/listing-contact-card.spec.ts' --include='src/app/boards/listing-talking-card.spec.ts' --include='src/app/boards/stack-story-frames.spec.ts' --include='src/app/boards/stack-card-selection.spec.ts' --include='src/app/boards/stack-script-persistence.spec.ts'
```

## Browser verification

Inspected the local board `9516561b-95ed-497e-89bd-63276083bb7f` in direct Live view on desktop and at 390 × 844 and 320 × 568. The final screen displays the saved contact links, completed progress, smaller replay/return controls, and footer branding. The previous arrow stays clear of the heading on mobile; all four actions fit on the short phone viewport.

Phone/email destinations were inspected without placing a call or sending an email. No board records were edited during verification.

The original implementation's browser checks confirmed Watch again restarted at the cover and Return to board opened the regular 12-card view with its contact card intact. For the revised sequence, verified the original contact card's existing wording and played its saved narration. It automatically advanced to the separate completion screen with no narration control, with Call/Email and replay/return still visible. Checked the silent final screen again at 320 × 568. No console errors were observed; existing four-item collection tracking warnings appeared during board hydration/HMR.

## Build and release

TypeScript checks, French/Japanese catalogs (3324 messages), and the production hosting build pass. The Boards bundle remains within the existing 450000-byte gzip budget. Existing Boards stylesheet/CommonJS warnings remain unchanged.

Implemented locally. Production hosting has not been deployed.
