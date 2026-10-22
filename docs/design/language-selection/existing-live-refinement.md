# Language control in the existing Live player

Inspected the running local board and current source: boards.html stack-viewer-overlay--top / stack-viewer-actions, boards.css stack-viewer-story and mobile rules.

The actual desktop experience centers a portrait story on a black stage. Mobile uses a full-viewport story. The existing multicolor border, image crop, title, narration/play/share/QR/close controls, photo tray, navigation and CTA are retained in the revised concept.

Recommended placement: a compact globe + current-language code + chevron pill on a second row immediately below the top toolbar, aligned to its right edge inside the story. The current five-button card toolbar is already crowded, especially at 390px width, so this new row avoids shortening the board title further. Give the new control a minimum 44px touch target in implementation.

Desktop: open an anchored compact popover beneath the pill, within the story bounds. Phone: open a dark translucent bottom sheet over the lower part of the existing story. Pause playback and narration while either is open. The revised mobile illustration uses immediate language selection rather than the earlier confirmation-button variation; error/loading handling remains part of implementation planning.

Artifacts:
- current-live-desktop.jpg and current-live-phone.jpg: actual running application screenshots, without a language control.
- 03-existing-live-desktop-language.png: built-in image_gen edit adding the proposed pill to the existing desktop screenshot.
- 04-existing-live-phone-language.png: built-in image_gen edit showing the proposed pill and bottom-sheet states using the existing mobile screenshot.
- existing-live-prompts.txt: exact edit prompts.

These remain visual concepts. No application code was changed.
