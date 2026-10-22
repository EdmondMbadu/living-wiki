# Preserve the original toolbar; integrate language with audio

Latest direction: user prefers the earlier layout over the bottom dock redesign. Keep original Live view controls, separate CTA and photo strip. Add the selected language code and chevron directly beneath the existing speaker icon within one compact Audio & language button. No separate floating globe pill, new toolbar column or footer dock.

On phone, the combined button opens an Audio & language bottom sheet containing a narration action and language choices. On desktop it can open a compact anchored menu. Changing the language applies to text and narration, preserving the previously agreed browser-local preference across boards and initial-visit chooser.

Interaction tradeoff: opening this combined menu replaces the existing speaker button's immediate narration action; retain Play/Stop/Replay narration inside the menu, reflecting the current playback state. Keep the original story play/pause control separate. Pause story and narration while choosing a language; define resume/cancel explicitly when implementing. Give the combined control at least a 44px target and an accessible name such as Audio and language, English. The displayed code is secondary to the native language names in the picker.

Images were generated with the built-in image_gen tool using actual current-live-phone.jpg and current-live-desktop.jpg screenshots. Exact prompts: integrated-audio-language-prompts.txt. These remain visual concepts; no application code changed.

- 07-existing-toolbar-audio-language-phone.png
- 08-existing-toolbar-audio-language-desktop.png
