# Team workspaces

## Product behavior

The existing account menu and desktop/mobile navigation are reused. **Create team** lives in the avatar menu. A regular account can create one non-deleted team; a platform administrator (`users/{uid}.role == admin`) can create multiple. Joining other teams does not consume this allowance. Archiving or transferring ownership does not reset the original creator's allowance; permanently deleting the team does.

The creation entry remains visible even while allowance checks are loading, unavailable, or report a used allowance. The creation page explains the actual limit or offers a retry; only the server can grant creation. Creation availability and invitation loading have independent loading/ready/error states. A failed inbox request never renders “You’re all caught up.” Checks time out after 15 seconds, retries can recover, and older requests cannot overwrite a newer result or populate another account's state.

The creator becomes the owner and a **team** admin, not a platform admin. The Teams sidebar item appears only after creation or invitation acceptance. One active team opens directly; multiple active teams open a chooser. Archived teams remain accessible from My teams in the account menu.

The workspace includes:

- Branded hero, logo, description, website, public contact details, and configurable accent.
- Listings, Members, and About sections; searchable listings with status/representative filters, list/grid views, and pagination.
- Shared real-estate TalkThru creation through the existing board wizard and editor.
- Listing photo-source choice: use the URL gallery or upload up to 24 photos, remove photos, and choose a cover. The URL remains required for property facts. Uploaded photos replace the scraped gallery and use the same room classification and grounded narration pipeline. Team photos remain in private `team-media` until explicit publication; draft preferences preserve their storage references and cover order. Failed uploads can retry without re-uploading successful files, and uncertain rooms remain marked for review.

The listing-upload frontend requires updated `generateBoardWizardBatch` and `teamCommand` callables. Deploy both with `firebase deploy --only functions:generateBoardWizardBatch,functions:teamCommand --project living-atlas-7622a` before releasing the frontend. Existing Storage rules already cover these private team and owner-scoped personal uploads.
- Representative assignment, separately selected shared voice, revision history, unpublished-change indicators, explicit publication, QR downloads, and team-owned video assets.
- Accepted members, pending invitations, roles, public-profile opt-in, shared-voice consent, leaving/removing members, and owner transfer.
- Views, unique engaged participants, chat sessions/messages, verified voice minutes, explicit contact requests, private conversations, and activity/notifications.

The public page is `/team/{slug}` and starts unpublished. The private workspace is `/teams/{teamId}`. Publishing a team page and publishing an individual listing are separate choices. Saving a listing never updates its public snapshot. Restoring an archived team does not republish anything automatically.

### Team settings

Team admins can save an individual setting without completing the rest of the profile. The form sends only changed fields, using the revision captured when it opened. Omitted fields stay unchanged; explicit empty optional values clear descriptions, contact details, website, logo, or cover. Leaving the team name blank keeps the existing name; a replacement name must have at least two characters. Reset accent restores the default green. Invalid newly entered website/email values show a useful error, while blank values are valid.

Remove logo and Remove cover photo update the preview immediately and take effect on Save; Cancel restores the saved images. Removing a cover resets its focal point. Removal withdraws the image from the team page and membership indexes, not from existing public Storage URLs (branding objects remain immutable). Failed saves preserve the draft. The dialog backdrop handler must return void: returning false for clicks inside the dialog cancels native submit and checkbox behavior.

Deploy the updated `teamCommand` callable before serving the partial-update frontend: `firebase deploy --only functions:teamCommand --project living-atlas-7622a`. Existing full-form clients remain compatible with the updated backend.

The Save button also invokes the handler directly and prevents the duplicate native submit action, so cancelling the browser's default action cannot silently swallow the save. Stale forms without an opening revision show an actionable error instead of returning silently. Settings errors appear next to Save and receive focus/scroll into view; drafts remain intact on failure. After a development hot reload, refresh the page and reopen settings to initialize a fresh editing session.

Hosting revalidates the team-route HTML in English, French, and Japanese instead of caching it for an hour, so newly opened workspaces pick up the current hashed JavaScript after a release. Already open tabs still need a reload after deployment.

The September 13 Save-click hotfix passes all 47 team browser tests, including cancelled native submits, stale forms, and visible validation errors. A separate in-app-browser preview confirmed an edited field followed by Save produces the success notice. The production app compiled; the existing boards gzip-size check still fails (434.6 KiB versus 322.3 KiB). Before the hosting hotfix, its `chunk-6EW3YASR.js` was verified byte-for-byte identical to the live asset. The hotfix does not change that bundle or raise/disable the size limit.

## Permissions

| Capability                                                                  | Visitor | Active member           | Team admin  | Owner       |
| --------------------------------------------------------------------------- | ------- | ----------------------- | ----------- | ----------- |
| Published pages/listings and opted-in member profiles                       | Yes     | Yes                     | Yes         | Yes         |
| Team listings, cards, shared drafts, aggregate analytics                    | No      | Yes                     | Yes         | Yes         |
| Edit team listings/cards                                                    | No      | Yes                     | Yes         | Yes         |
| Publish/unpublish a listing                                                 | No      | Assigned representative | Any listing | Any listing |
| Private contacts and verified conversations                                 | No      | Assigned representative | Any listing | Any listing |
| Select an explicitly shared team voice                                      | No      | Yes                     | Yes         | Yes         |
| Share/revoke a personal voice or opt into public contact details            | No      | Self only               | Self only   | Self only   |
| Invite/remove members, change roles/branding, assign reps, archive listings | No      | No                      | Yes         | Yes         |
| Transfer ownership, archive/restore/delete the team                         | No      | No                      | No          | Yes         |

Platform-admin status permits additional team creation; it does not silently grant access to other teams' private workspaces. All capabilities are checked against canonical team/member records by backend functions and security rules. The sidebar membership index is not an authorization grant.

## Data and ownership

- `teams/{id}`: branding, owner/creator, state, revision, counters, tracking start.
- `teams/{id}/members/{uid}`: canonical membership, private invitation email, member profile, explicit voice grant.
- `teams/{id}/listings`, `/wizard_drafts`, `/activity`, `/limits`, `/runtime`: workspace summaries, shared drafts, audit trail, throttles, provider readiness.
- `users/{uid}/team_memberships`, `/team_notifications`: server-maintained navigation and notifications; a user may mark their own notification read.
- `team_creation_quotas`, `team_slugs`, `team_invitations`: creation limits, immutable public addresses, email-bound invitation state.
- `team_boards/{boardId}` and `/revisions/{revision}`: private working listing and optimistic-concurrency history.
- `boards/{boardId}`: allowlisted Public or Unlisted visitor snapshots. `public_team_listings` and `public_team_pages`: Public-only directory projections; Unlisted snapshots never enter the listing directory.
- `team_published_configs`: private voice/representative configuration for the published revision.
- `team_analytics_daily`, `team_participants`, `team_contact_stats`, event receipts: measurement data.
- `team_contacts/{id}/requests`, `team_conversations`, `team_voice_sessions`: private requests, verified call transcripts, and server-issued call attribution.

Creator, team owner, listing representative, last editor, and voice owner are distinct. Removing a member does not remove their team listings. Their shared voice grant is revoked; listings needing a new representative remain visible to admins.

Private team working copies are excluded from the personal local-storage board cache. Media uses authenticated reads and temporary browser object URLs, which are revoked when access changes. Team switching and delayed loads are scoped so one workspace cannot populate another workspace's draft list.

### Editing and publishing

Mutations use `teamCommand` rather than direct client writes. Saves carry a base revision. Independent changes to different cards can merge; overlapping edits, deletion conflicts, or incompatible reordering are rejected instead of overwriting a teammate. The editor retains unsaved fields on ordinary save conflicts. Repeated identical save requests are idempotent.

Working copies remain private. Publication validates Talking Card knowledge visibility, checks the representative/admin capability, prepares immutable public media, and rechecks membership/revision before writing a public snapshot. Author-only setup cards and private metadata are excluded. Public and Unlisted links and QR codes keep the same listing ID across revisions. `published_visibility` on the working copy records the visitor audience independently of its always-private `visibility`. Workspace summaries expose `publishedVisibility` as Public, Unlisted, or Private. The explicit `publishUnlisted` operation fails on older servers rather than silently publishing a request publicly. Older clients updating an already-Unlisted listing preserve its audience when no new audience is provided.

Personal real-estate listings can be explicitly copied or moved. Copy leaves the original untouched and assigns new card IDs. Move keeps the board ID and reserved custom alias but immediately withdraws the old public version. Imports start as private team drafts and reset personal narrator/video fields. Owned listing-image uploads are copied into team storage. External image links remain external. Linked child boards are rejected rather than implicitly sharing private child content; inline related cards are supported.

Deletion requires an archived listing/team and confirmation. Private listing history, contacts, and conversations are removed. Minimal private URL tombstones remain so old links cannot be claimed by someone else. Team deletion also removes team-scoped storage and releases the creator's allowance. Private media may be referenced by another listing in the same team, so individual-listing deletion retains those team uploads until team deletion; its independent public copies are removed.

Lifecycle cleanup is retryable while a team is marked `archiving` or `deleting`. Large cleanups are synchronous and bounded by the callable timeout; before expanding to very large workspaces, move them to queued jobs. If interrupted, an operator can retry the same `lifecycle` command as the owner, with the exact team ID, operation, and confirmation name; do not manually change ownership/quota documents.

### Invitations

Invite up to 30 addresses at once. Batches validate and commit atomically before sending email. Duplicate addresses and existing members are handled explicitly. Pending invitations do not create memberships or expose listings. Acceptance requires a verified matching Firebase Auth email and an explicit action. Tokens are hashed at rest, expire after seven days, and rotate on resend. Resend is throttled to once per minute; a team can send 200 invitations per UTC day. Failed email delivery is shown distinctly from successful invitation creation; invited users can also find invitations in their account menu.

### Voices and conversations

Each member may explicitly share one ready personal-library voice with the team. The grant records the library voice revision and is validated again before publication, generation, and live use. Voice selection is independent from representative assignment. Revocation or removal prevents new use of the personal voice; live conversations can fall back to a system voice. Regenerating content is explicit.

Previously downloaded/rendered audio/video cannot be recalled, and a credential already issued for an active provider call cannot be forcibly recalled by these changes. Team page membership is not permission to access a member's private voice samples or entire voice library.

Verified voice callbacks are bound to a server-issued session, provider agent, conversation ID, and start time. HMAC signatures use the raw request bytes; repeated callbacks do not double-count. Transcripts are bounded to 100 turns of at most 2,000 characters each. Conversation/session TTL policies require deployment. Conversation TTL is 90 days and deletion is asynchronous; configure the product's retention/disclosure policy before inviting real visitors.

## Metric definitions

Date windows are inclusive UTC days: 7, 30, or 90. Logged-in team previews are excluded.

- **Views:** one listing view per browser session per UTC day, not every render/reload.
- **Participants:** distinct engaged browser IDs across the selected period, not the sum of daily unique counts. This measures browsers, not verified people.
- **Chats:** distinct listing/browser sessions with at least one user message.
- **Messages:** deduplicated user-message events, excluding assistant responses.
- **VR chat minutes:** provider-verified call duration, not browser elapsed time. Shows `—` until the team has a verified callback; no historical durations are invented.
- **Contacts:** distinct requesting email/listing pairs active in the period, submitted through the consented contact form. Email/phone clicks are not contacts. Repeat submissions retain request history without inflating the unique count.

Historical aggregate analytics may include deleted listings; published-listing counts reflect current state. Metrics failures display unknown/unavailable, not fabricated zeroes. The interface has expandable participant/chat/message metrics so more measures can be added without widening the primary table.

## Deployment checklist

1. Resolve the pre-existing board JavaScript performance-budget failure described below before a production release. Do not bypass the check or raise budgets silently.
2. Deploy Firestore rules, Storage rules, indexes, and TTL policies from this change. Wait for required indexes to become ready. No migration of existing personal boards is required.
3. Deploy new callables: `teamCommand`, `getPublicTeamPage`, `getTeamInvitationPreview`, `getTeamInsights`, `submitTeamContact`, `manageTeamContacts`, `getTeamConversations`. The optional `teamVoiceWebhook` is intentionally not exported from the Functions entry point; ordinary full deployments do not require its secret.
4. Deploy changed existing functions too: board analytics, voice session creation, narration synthesis, script shortening, trailer preparation, and board-friend creation notifications. Deploying only new team exports is insufficient.
5. Ensure `SENDGRID_API_KEY` is available to `teamCommand`. Configure a verified `INVITE_SENDER_EMAIL` (fallback is the app's existing Mission Control sender). Invitation links currently target `https://www.livingwiki.com`; use the matching authorized host for staging before sending staging invitations.
6. **Deferred, not a release prerequisite:** Keep existing voice/chat behavior. Do not create an `ELEVENLABS_TEAM_WEBHOOK_SECRET` or enable the new provider integration for this release. If the product adopts verified provider calls later, configure the real provider signing secret first, explicitly restore the `teamVoiceWebhook` export in `functions/src/index.ts`, and configure/test the provider's post-call transcription webhook. The handler and signature checks remain available in `team-voice.ts` for that future work. Never expose an unsigned webhook or fabricate call durations; those metrics remain unavailable until actual verified callbacks exist.
7. Verify Storage CORS permits authenticated SDK `getBlob` reads from the actual app origins. Private team media deliberately does not use permanent public download tokens. Branding uploads are public assets; the settings UI warns about this.
8. Deploy Hosting only after backend readiness, and run the staged checklist below with separate owner/member/visitor sessions.

### Authorized rollout — September 13, 2026

- Deployed Firestore and Storage security rules to `living-atlas-7622a`. All seven team composite indexes are confirmed `READY` and all seven team TTL policies are `ACTIVE`. Preserved the two additional existing chat indexes found in the live project.
- Deployed all seven team callables and updated the six related functions listed above. All thirteen report `ACTIVE`.
- Confirmed the existing `SENDGRID_API_KEY` has an enabled version, without reading its value. Checked bucket CORS: production app origins and the existing localhost origins already permit authenticated media reads. No CORS changes were needed.
- Verified deployed endpoints with unauthenticated/invalid-input requests and the production-origin CORS response. These checks verify routing, handler availability, validation, and authentication boundaries, not signed-in end-to-end team creation.
- `ELEVENLABS_TEAM_WEBHOOK_SECRET` does not exist. The initial scoped rollout excluded `teamVoiceWebhook`, but a subsequent full Functions deploy still tried to validate it. The follow-up fix removes the endpoint export entirely, so full discovery no longer includes the webhook or its secret. No new provider or secret is needed for current team features. Existing voice/chat behavior is unchanged; verified call metrics are deferred.
- Frontend source fixes are complete and tested locally. Hosting was **not** deployed: the production build compiles, but the existing board performance check still fails (430.8 KiB gzip versus 322.3 KiB). The check and its limit were not bypassed or raised.

Email delivery, paid voice/video generation, and a real signed-in owner/member/visitor workflow remain untested in production. No test teams, user records, invitations, contacts, or provider calls were created. Cloud changes were restricted to the authorized backend, security rules, indexes, and retention configuration.

## Verification

Automated commands:

```sh
npm test -- --watch=false --browsers=ChromeHeadless
npm --prefix functions run test:teams
npm run test:firestore-rules
npm run test:storage-rules
npm run build -- --configuration development
npm run build:hosting
```

Browser tests include the real team component, filtering all listings before pagination, role-specific actions, public/private separation, preserved settings on conflicts, existing navigation, team studio access, author-only card visibility, revisioned saves, and team-owned video storage. Backend integration tests execute real callable handlers against the demo Firestore emulator; Auth lookup, email delivery, and Admin Storage operations are stubbed. Storage security is tested separately against its emulator. Tests never target a production project.

Previous rollout checks: **479 browser tests, 68 Firestore/backend integration tests, 10 Storage security tests, and 9 team policy tests**. Regressions cover avatar-menu discoverability for unknown/denied/allowed quotas, failed-versus-empty invitation states, retries, independent check failures, stale requests, and account changes. A tenth team test now uses Firebase's actual full deployment-discovery routine to ensure the deferred webhook and secret are absent while core team and existing voice endpoints remain available. Run the Firestore and Storage emulator suites sequentially because they share ports.

The webhook-deferral follow-up passes the Functions TypeScript build, all **10 team tests**, and the existing realtime-voice isolation checks. It changes deployment discovery locally; no full production redeployment or provider setup was performed during that follow-up.

The desktop and 390-pixel mobile layout were visually checked using the local component test fixture (`teams.spec.ts` watch mode, `/debug.html?team-preview=1`). The fixture does not load customer data and is not included in production.

### Known existing performance blocker

The localized production Angular build compiles, but `scripts/check-board-performance.mjs` rejects the monolithic board bundle. An isolated build of the unchanged base commit also fails: approximately **428.6 KiB gzip** versus a **322.3 KiB** budget. The first team build measured approximately **430.5 KiB**. This change does not raise or disable the budget. The board component's existing stylesheet remains under the hard size limit; team-only editor styles are in a separate stylesheet.

### Staged end-to-end acceptance

- Create a team from the avatar menu. Verify owner/admin assignment, sidebar appearance, a rejected second regular-account creation, and multiple platform-admin creations.
- Invite a second verified account, accept from email and from the account inbox, and test duplicate/expired/revoked invitations and failed-delivery feedback.
- Upload branding, position the hero at both 0% and 100%, opt into the public profile, and verify the public page contains no workspace controls, invitations, private emails, contacts, or analytics.
- Have two members edit different cards, then the same card. Confirm safe merge versus a preserved conflict. Resume another member's wizard draft.
- Save without publishing; verify an anonymous visitor still sees the previous snapshot. Publish, open the QR link, unpublish, and confirm the old link becomes unavailable.
- Share/select/revoke a ready voice, render both video formats, reopen as another member, and confirm no member-private video-library dependency. Verify approved Talking Card knowledge and live voice selection with the provider.
- Submit an anonymous contact; check notification, representative/admin-only contact access, status changes, pagination, and verified conversation access. Verify aggregate counts exclude team previews.
- Remove an actively editing member; verify private reads/writes fail and private UI/media is cleared. Confirm personal boards are unchanged.
- Copy and move personal listings, transfer ownership, archive/restore, and permanently delete a disposable team. Verify stable-link tombstones, private cleanup, and creator allowance release.

## Deliberate first-release limits

No billing/paywall, per-card ACLs, simultaneous character-level editing, automatically shared personal knowledge, linked child-board migration, team-specific document export, or server-rendered public-team SEO was added. The initial safety limits are 200 accepted members, 30 invitations per batch, 200 top-level cards per listing, 850 KB serialized listing input, and eight levels of inline related cards. These are product/abuse limits rather than paid tiers.
# Team invitation notifications and email delivery (September 2026)

- A shared bell next to the signed-in avatar opens `/notifications`. Its attention count is pending invitations plus unread updates, without double-counting invitation projections or limiting the unread count to recent history. The avatar menu contains a secondary Notifications link. This works without an existing team membership.
- The notification center separates invitations needing a response from recent updates. Marking updates read never accepts, declines, or hides an invitation. The old team-only notifications modal was removed. A dismissible invitation reminder appears outside review/auth routes; dismissal lasts for the current browser session and invitation set. A new invitation or resend makes it appear again.
- Canonical invitations remain server-only. `syncTeamInvitationNotification` projects the latest state into `users/{uid}/team_notifications/invite-{invitationId}` only after checking the recipient's current verified Firebase Auth email. The authenticated `inbox` action hydrates old invitations and invitations sent before signup/verification. Team availability changes also refresh these projections. Clients can only mark ordinary updates read, never create notifications or modify invitation projections.
- Authenticated realtime listeners keep the badge and invitation list current across tabs. Listeners and pending requests are isolated by account; refresh errors remain visible and do not masquerade as an empty inbox. Focus refresh repairs missed hydration, and local expiry checks remove expired invitations from the attention count.
- Existing email links remain `/teams/invitations?invite=…&token=…`. Sign-in, signup and email verification preserve the destination. The selected invitation is highlighted; wrong accounts can switch without losing the link. Acceptance is explicit, email-verified, transactional, and idempotent. Link previews never grant membership. Accepted, declined, expired and unavailable links have explanatory states.

## Delivery operations

`teamCommand` atomically creates each invitation and a server-only `team_invitation_emails` job. `sendTeamInvitationEmail` sends new jobs, while `retryTeamInvitationEmails` checks due jobs every five minutes. Only the workers bind the existing `SENDGRID_API_KEY`; no new provider, webhook secret, or ElevenLabs integration is required.

The existing verified sender is used (`INVITE_SENDER_EMAIL` when configured, otherwise `missioncontrol@rocketgoals.com`, display name LivingWiki). Do not change to an unverified sender. Emails include team/inviter/role, expiry, an explicit Review invitation button, direct text fallback, and a reminder that personal boards/voices stay private. Click/open tracking is disabled for these transactional links.

Delivery is separate from membership: `queued` → `submitted` → `delivered` when SendGrid's authenticated Email Activity API confirms mail-server acceptance. A provider submission is never labeled delivered. Activity checks are bounded; unavailable activity data leaves the honest submitted state. Admins can use Members → Invitations → Refresh email status. Inbox placement, opening and human receipt are not implied by delivery.

Workers use transactional leases. Known 429/5xx failures retry with exponential backoff up to five total attempts; permanent errors stop. Unknown network outcomes or expired processing leases become `unknown`, requiring a recipient check before manual resend, to avoid blind duplicate sends. Superseded, revoked, expired and unavailable-team jobs are cancelled before sending. A resend rotates the token; old jobs cannot overwrite the current invitation's delivery state. Raw tokens are removed from jobs after submission or termination; recipients cannot read jobs, tokens, provider IDs or errors. Logs contain only opaque job IDs and sanitized error codes.

Required deployment exports: `teamCommand`, `getTeamInvitationPreview`, `sendTeamInvitationEmail`, `retryTeamInvitationEmails`, `syncTeamInvitationNotification`, `syncTeamInvitationAvailability`; deploy Firestore rules/indexes and Hosting alongside them. Firebase requires explicit confirmation (`--force` for a **scoped** noninteractive deployment) when first enabling trigger retry policies. Do not use an unscoped force deploy as a shortcut.

Validation: 63 focused Chrome tests, 77 Firestore emulator/integration tests, and 27 backend team tests passed during implementation. Desktop, 390px and 320px layouts were visually checked with the isolated `notifications-preview` Karma fixture. No production invitation or email was created as a test. The provider's read-only activity records reported the two existing recent invitations as delivered; this does not verify their location inside the recipient's mailbox. Production compilation succeeded; the existing Boards feature gzip budget remains exceeded (434.6 KiB versus 322.3 KiB). No Boards source or performance budget was changed for this release.

## Board visibility rollout

Deploy the updated Firestore/Storage rules and affected functions before releasing the visibility controls. Existing boards keep their current settings and creation defaults. Unlisted is anonymous link access, not an invitation or team-membership grant. Link recipients can forward the address.

Personal `boards` reads distinguish `get` (Public or Unlisted, plus authorized owners/admins) from public `list` (Public only). Owners can find hidden boards under “Private & unlisted” on their profile. Current full-board saves include `visibility_schema_version: 1`; older full saves cannot turn Unlisted into Public accidentally. Explicit narrow privacy updates remain available. Nested boards inherit the parent setting. Private plan requirements are unchanged; Unlisted does not require the Private entitlement.

The team board editor exposes visitor visibility in Board settings and Edit board cover, as well as Manage on the team page. The selector reflects the published audience independently of the private working copy. For representatives/admins, the save button explicitly saves the draft and publishes the visitor version with the selected audience, or unpublishes for Private. Other members can see the audience and save working edits without publishing. Publication uses the revision returned by the draft save; a publication failure keeps saved working edits and reports that visitor visibility did not change.

The summary and city listing triggers use canonical transactional reads so stale events cannot restore discovery entries. Hidden boards are removed from public summaries, team listing directories, and collection board references. This cleanup is asynchronous and retryable. Public collections and catalog publication remain Public-only. Share previews and proxied videos recheck access on each request and use `private, no-store`; Unlisted pages/previews use `noindex`. Previously obtained or downloaded files and search-engine results cannot be recalled immediately by changing the setting.
