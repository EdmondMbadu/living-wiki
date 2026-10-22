# Visitor language selection concept

Concept images generated using the built-in image_gen tool. The prompts are saved in prompts.txt. These are design proposals, not implemented screens. The house photograph and collection name are illustrative.

- 01-first-visit-phone-desktop.png: first QR visit opens a full-screen chooser on phones and a centered modal over the Live player on desktop.
- 02-change-language-phone-desktop.png: a persistent globe + current-language pill opens a phone bottom sheet or desktop popover.

## Proposed behavior

- Apply to both card and board QR entry. Preserve the scanned card when entering the experience.
- Suggest the browser language if supported, with native language names as primary labels. Flags are supplemental visual cues and should not define language identity. Populate actual choices from the supported text-and-narration languages when implementing.
- One confirmed language controls both displayed content and narration.
- Start in the selected language after an explicit visitor tap. Audio playback still needs to respect browser playback restrictions.
- Remember the confirmed preference in browser-local storage across boards. Returning visits skip the chooser when that preference remains supported. This does not imply cross-device persistence.
- Keep the globe + current-language code visible with an accessible full language label and generous touch target.
- Pause narration while the switcher is open. Cancel retains the current language; confirming switches language and updates the saved preference. Distinguish current and pending selections accessibly in implementation.
- Localize chooser interface copy and action labels as appropriate; generated images illustrate the English interface.
- Next phase: plan translation and narration availability, caching, preparation time, and recovery states. No latency or language-support commitments are implied by these mockups.

## Visual cleanup for implementation

The generated desktop switcher image labels narration as paused but draws a pause symbol. A working paused player should show the play action instead.
