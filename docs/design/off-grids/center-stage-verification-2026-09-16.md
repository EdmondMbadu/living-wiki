# Off Grids center-stage implementation — September 16, 2026

Implemented locally. Hosting has not been deployed.

## Delivered

- /off-grids/:spotId now loads its own lazy OffGridDetailComponent. The gem occupies a centered page at every screen size; the directory is absent.
- Large cover, H1, attribution, complete stored story/access notes, Save, directions, sharing, exact location, PinTalks, owner controls, and original-board navigation.
- Mobile action bar includes safe-area and page padding. Covers preserve the photographed subject rather than forcing a crop.
- A centered skeleton renders immediately. Existing card content provides a temporary preview on clicks; permissions, clips and actions wait for authoritative detail.
- The native hero image loads once, while a small preview can remain visible until its load event. There is no separate JavaScript image preloader.
- Directory cards request the small cover instead of advertising a 1600w source for every card.
- Direct detail pages never request the directory. Concurrent details combine by spot ID and restored authentication context.
- waitForSession uses Firebase Auth's authStateReady. Detail reads do not wait for the profile-sync write. Initial session restoration can share the pending detail request; completed details do not automatically repeat at profile readiness.
- Search, scope, grid/map mode, bounds, loaded pages, pagination and scroll are remembered in a bounded memory snapshot. Fresh return navigation reuses it; stale pages revalidate up to the previous count before restoring position.
- Scroll restoration accounts for Angular's global navigation scroll-to-top. Focus moves to the selected heading and returns to the original card.
- Route/auth versions reject late results. Pending actions belong to their route context; an older action cannot reset the new page's busy state or close its dialogs.
- Account changes clear private views and previous-account snapshots. Previews contain no owner authority, contribution permission, protected clips, original-board link, or share URL.
- Location maps load on Show map. Recording UI and QR code generation remain deferred; videos retain preload=none.

Backend APIs, identifiers, share URLs, source-visibility checks, media grants and private media access enforcement remain compatible. The existing social share handler still redirects to /off-grids/:spotId, which now uses the centered page. Public copied links use the new layout after the hosting build is deployed.

## Verification

36 passing ChromeHeadless tests across Off Grids and board Off Grid location specs.

Coverage includes direct-page request counts, complete story rendering, preview gating/access failure, A-to-B races, session readiness, logout, moderation completion after navigation, busy-state isolation, save/unsave, featured ordering, dialog focus/Tab/Escape, cached browse returns, stale pagination restoration, session request coalescing, retry/invalidation, account snapshot deletion, recording permission/track lifecycle, upload cancellation/finalization, editor validation, and coordinate/directions handling.

Production build, prerendering, translation checks and bundle budgets passed. French and Japanese catalogs each contain 3,313 registered translations. Existing Boards CSS warning and third-party CommonJS notices remain build warnings.

Live local browser checks:
- Directory selection renders the centered gem immediately with a preview, then validates its actions.
- Fresh direct gem URL renders the same centered destination.
- Directions contain the saved exact point, including the expected what3words link.
- Public sharing sheet and SVG QR generation work.
- Owner gem retains Edit gem and contribution controls.
- PinTalk composer opens and closes without starting recording automatically.
- Browser Back restores focus to the selected card.
- All Off Grids preserves the Monterey search and its five results.
- Show map loads the saved location on demand.
- 390 px and 320 px layouts keep actions usable and footer content accessible.
- Default desktop and 1920 px desktop layouts center the stage within the app content area.
- No console errors/warnings appeared in these local interaction checks.

Camera capture, publishing, and moderation were not performed against live user records in this pass. Existing implementation remains in place; relevant local component/service tests pass.

## Performance observations

Public live HTTP samples before the UI changes:
- Directory: 0.461 s, 15,373 bytes.
- Anonymous detail: 0.333 s, 1,268 bytes.
- First sampled small photo: 1.246 s, 21,628 bytes.
- Sampled large photo later: 0.265 s, 70,916 bytes.

The chosen sample's small rendition is 69.5% smaller than its large one. Other images and worker startup times vary.

Production build served locally, anonymous browser, warm live read workers, two sample loads:

| Measurement from navigation start | Sample 1 | Sample 2 |
| --- | --- | --- |
| Directory cards rendered | 488 ms | 448 ms |
| Directory first cover painted | 755 ms | 658 ms |
| Directory last observed LCP within 4.5 s | 860 ms | 684 ms |
| Direct gem title rendered | 643 ms | 459 ms |
| Direct gem cover painted | 791 ms | 721 ms |
| Direct gem last observed LCP within 4.5 s | 832 ms | 752 ms |

Directory: one directory request, zero detail requests, small covers only, zero video requests. Direct gem: zero directory requests, one detail request, one large-cover request, zero video requests. No map is requested before interaction.

Measurements used a temporary local HTML instrumentation server. It collected native paint/resource observations and aggregate request counts, without credentials, UID values, media grants or asset URLs in its logs. No diagnostics were added to the application. The viewport was expanded for the second direct-page visual check; these are sample observations rather than a controlled percentile benchmark.

Directory bundle is approximately 10.0 KiB gzip, compared with the previously recorded 13.8 KiB combined directory/detail bundle. The separate detail bundle is approximately 13.1 KiB gzip; editor remains approximately 13.1 KiB.

The user's earlier five-second full load was not reproduced under these warm conditions. Cold workers, uncached application scripts and network/device conditions can still add time. No paid minimum warm instances were configured, and no new backend read endpoint was needed for the measured fast detail response.

