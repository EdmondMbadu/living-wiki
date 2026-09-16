# Off Grids — implementation and verification

Implemented September 16, 2026. Available at `/off-grids`, with a sidebar entry and public, authenticated creation, and owner edit routes.

## Delivered behavior

- Explore, My pins, Saved, search, cursor pagination, and a lazy Google Maps view.
- Photo-led cards, desktop detail panel, mobile detail page, dark theme support, accessible dialogs, and 44-pixel view/map controls.
- Place → Story → Review creation, with GPS, map pin, coordinates, supported Google Maps coordinate links, and server-side what3words lookup. A valid latitude/longitude and explicit point confirmation are required to finish a gem.
- Private drafts and new gems by default. Public publishing is an explicit review choice. Existing imported cards retain their source visibility.
- PinTalk camera recording, microphone control, camera switching, local review, upload, trim, caption/transcript, progress, cancellation, retry, and server processing. In-app recordings are limited to 90 seconds; uploaded videos to three minutes and 100 MB.
- Accepted friends can contribute PinTalks to enabled public gems. Their clips remain pending until owner approval. Owners can feature and remove clips.
- Exact-coordinate directions, native sharing where available, copyable public links, downloadable SVG QR codes, and public social photo previews.
- User-scoped draft recovery, including staged cover photos. Saving attaches a staged photo atomically; merely uploading one does not change an existing public cover.
- Current source-board/card visibility is checked on reads and media requests. Private originals/renditions have no permanent Firebase download tokens.
- Source-board edits/deletions project into deterministic gem IDs. Imported edits update the original card; a private source board cannot be made public through this page.

## Migration

The initial inventory audited 3,411 boards, including explicitly tagged cards outside Off Grid boards. Four source boards contained 17 Off Grid cards. All 17 now have valid confirmed coordinates and optimized small/large covers. Two words-only cards were repaired through what3words. One existing Talk Drop video is preserved as a PinTalk. No duplicate source cards or boards were created. See `migration-audit.json`.

## Verification completed

- Frontend: 17 passing tests covering coordinate parsing, zero/cleared numeric input, supported links, directions, camera permission failure, recording/track cleanup, dialog focus/Tab/Escape, and upload cancellation/finalization races.
- Backend: six model tests, seven Firestore integration tests, six real media/HTTP tests, and existing Talk Drop validation.
- Security rules: five passing Firestore/Storage access tests.
- Production build and French/Japanese catalog checks pass. Each catalog contains 3,312 complete registered translations.
- Live signed-in browser flow: confirmed a synthetic point, uploaded a cover and a durationless WebM, saved privately, loaded the exact-location map, saved the gem to Saved, and played its normalized two-second PinTalk to completion with no media error.
- Live anonymous checks: private detail, private video, and private social link all return 404. Public discovery remains 17 gems, with 12 on the first page and the remaining five reachable through pagination.
- Mobile layouts checked at 390 and 320 pixels. Public share sheet, SVG QR rendering, dialog focus, and exact directions verified.
- Emulator checks cover pending approval, unpublication, source visibility changes, deleted source cards, stable migration IDs, bounded Saved pagination, whole-world/antimeridian map bounds, invalid/overlong files, Safari-style byte ranges, and cancellation during processing.
- Synthetic test gem, uploads, media, Saved record, and scoped grants were removed after verification.

The live camera/microphone on the user's device, physical iPhone/Android Safari/Chrome capture, and HEIC files from actual phones were not exercised. Camera lifecycle and permission behavior are covered with component tests; uploaded MP4 and browser-style WebM are covered with real processing tests.

## Performance

Public directory responses use compact projections and batch source-visibility reads, with 12-item pages. The measured first live response was approximately 15 KB. Grid pages do not load video streams. Maps, recording UI, HEIC conversion, and QR generation load on demand.

Final English route bundles are approximately 13.8 KiB gzip for Off Grids and 13.1 KiB for the editor. Production size checks pass.

The previous Boards size check matched any bundle containing the text `app-boards`, sometimes selecting its much smaller Teams consumer. It now matches the actual component selector. An isolated unchanged checkout measured 445,964 bytes gzip for Boards; its corrected budget is 450,000 bytes. The current Boards bundle is slightly below that baseline. The temporary baseline checkout was removed.

## Deployment and maintenance

Firebase project: `living-atlas-7622a`. Functions, Firestore/Storage rules, required indexes, hosting, and the `/share/off-grid/**` rewrite are deployed. Both new composite indexes are READY.

Configure `OFF_GRID_WHAT3WORDS_KEY` in the Functions server environment; it is absent from browser assets and has no tracked fallback key. Private playback grants expire after five minutes. Media endpoints check current access on each request and send `private, no-store`.

Repeat the inventory with `node functions/scripts/migrate-off-grids.cjs`; use `--apply` for migration/repair. Deterministic source IDs make repeats idempotent.

Automatic collection of expired grant records and abandoned private upload objects is a future maintenance task. Cancellation blocks publication and retracts an already-finalized upload, but does not purge its private stored objects immediately.
