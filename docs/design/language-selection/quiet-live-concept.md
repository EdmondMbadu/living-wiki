# Calmer Live view language switching

Revised proposal after feedback that the top-right language pill crowded the existing toolbar. Image edits were generated with the built-in image_gen tool from current-live-desktop.jpg and current-live-phone.jpg. Exact prompts are in quiet-live-prompts.txt. No application code changed.

## Recommended layout

- Header: avatar, board title, card count/curator, More and Close. Share board and share card/QR move into More. This adds one tap to sharing, while improving room for the board title.
- Lower controls: consolidate playback, current language and the existing optional CTA into one translucent bar at the bottom, replacing the standalone CTA row. Retain the photo strip above it when available.
- Current language: show the native language name with a globe and chevron; the label is the switcher trigger. It controls text and narration and persists across boards in the same browser.
- Phone: open a language sheet above the lower bar. Pause narration and story advancement while open. Desktop: a compact menu anchored above the language segment.
- Museum cards without a CTA omit the Let's go segment; the remaining play and language controls use the available space. Cards without photos omit the photo strip.
- Keep the approved first-visit chooser. After confirmation, enter the scanned card and use this calmer persistent control.

## Implementation details to resolve

The current player distinguishes story playback from replaying card narration. The consolidated play control needs an explicit definition for initial start, pause/resume and replay, preserving access to each required action. Mute and replay can be available through an audio submenu or More. This is a design proposal, not an assertion that those existing handlers are interchangeable.

The mockups depict a property board because that is the running reference, rather than inventing a museum's content. The property CTA is conditional, not a requirement for museum visitors. Use at least 44px touch targets, native language names, accessible current-language selection and keyboard/focus behavior in implementation. Flags remain supplemental.

## Images

- 05-quiet-live-desktop.png
- 06-quiet-live-phone.png: closed and opened language sheet
