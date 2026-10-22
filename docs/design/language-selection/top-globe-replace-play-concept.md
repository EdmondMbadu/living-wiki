# Replace the top play/Stack button with language

Latest clarified direction supersedes the bottom-globe and speaker-label variations: keep Let's go at the bottom and keep the original speaker button. Replace the adjacent top play/Stack button with a globe and small current-language code. Toolbar order: speaker, globe/language, share board, share card/QR, close. The control count stays unchanged.

User intends Stack functionality to remain accessible at board level/Stack Studio. This proposal changes the visitor toolbar only; implementation must still provide narration start/stop through the speaker and preserve navigation. Story autoplay, pausing while the language chooser is open, and cover-frame playback need explicit handling because the current play button serves runtime playback, not only a Studio entry.

Globe opens a language bottom sheet on phone; desktop can use an anchored compact menu. Native language choices apply to displayed content and narration and persist on the same browser across boards. The original first-visit chooser remains the proposed entry flow.

Images generated with built-in image_gen from actual current-live-phone.jpg and current-live-desktop.jpg. Exact prompts are in top-globe-replace-play-prompts.txt. No application code changed.

- 11-top-globe-replace-play-phone.png: closed language control and open sheet
- 12-top-globe-replace-play-desktop.png: desktop placement
