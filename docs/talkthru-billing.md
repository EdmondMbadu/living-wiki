# TalkThru plans and billing

Pricing follows Jim's October 2026 grid: Solo Agent $19/mo, Agent Pro $39/mo and Agency & Team $25/agent/mo with a 3-agent minimum. Annual plans cost 10 months' price (2 months free). Every plan starts with a **first month free, cancel anytime**, and the first TalkThru needs no card.

## How it works for people

1. **/talkthrus → Pricing.** *Start free* (Solo) and *Bring your listings to life* (Pro) send a new visitor to create an account, then straight into the listing wizard (`/boards?create=real-estate`). The plan they clicked is remembered for later. *Or start your free month now* skips the free listing and opens the plan picker. *Explore for your team* opens the person's team (or team creation). *26+ agents? Let's talk* goes to the contact form.
2. **First TalkThru.** Free, no card, fully published with link and QR code.
3. **Plan picker.** It opens automatically when someone:
   - starts a second live personal TalkThru, or an eleventh on Solo (wizard, Board settings, or the board editor),
   - exports a video or trailer of a personal TalkThru without Agent Pro,
   - publishes a second team listing on a free team, or
   - invites more agents than a paid team has seats (this offers *Add seats in Billing*).
   The picker shows Monthly/Annual, the plans that solve the problem, and “$0 today · then $X starting <date>”. People who already used the free month see the plain price. People who already pay see *Switch to …* (prorated, no new checkout).
4. **Stripe Checkout.** The card is collected on Stripe. Stripe returns to the exact page they came from (`?talkthruCheckout=success&session_id=…`). The app confirms the session immediately (no waiting for the webhook), shows “Your free month has started”, and removes the parameters. Returning to `/boards?create=real-estate` reopens the wizard, so they continue where they stopped.
5. **During the plan.** *Account menu → TalkThru plan* (`/talkthrus/billing`) shows the plan, days left in the free month, first charge date, live listings used, and *Manage billing* (Stripe Customer Portal: change plan, card, invoices, cancel). Teams see a plan strip on their team page.
6. **When a plan ends** (cancelled, unpaid): the most recently updated personal TalkThrus stay live up to the free/Solo limit; the rest become private and are listed as *paused*. Nothing is deleted. Starting a plan again republishes them automatically. Teams keep their most recently updated published listing; the others are unpublished (like a manual Unpublish) and the owner gets a notification. Admins republish them after restarting the plan.

## Rules

| | Free | Solo Agent | Agent Pro | Agency & Team (per seat) |
| --- | --- | --- | --- | --- |
| Live personal TalkThrus | 1 | 10 | Unlimited | Unlimited (each member) |
| Video / trailer export of TalkThrus | — | — | ✓ | ✓ |
| Custom video branding | — | — | ✓ | ✓ |
| Published team listings | 1 per team | | | Unlimited |

- *Live* = Public or Unlisted personal real-estate or rental TalkThru (cards tagged `listing-story`, or `real-estate` + `listing`). Team listing snapshots and child boards never count.
- Plans with access: Stripe `trialing`, `active` and `past_due` (Stripe's retry window). Anything else is Free.
- One free month per account and per email address, and one per team (`talkthru_trial_claims`).
- Team checkout: at least 3 seats and at least the current members plus pending invitations; at most 25 (larger teams: contact). Team pricing is **graduated** (seats 1–10 at $25, every seat after at $19), so adding an agent never lowers the bill. Change `tiers_mode` in the setup script if Jim prefers volume pricing.
- Platform admins are never limited. To give someone a plan for free (Jim's beta agents, partners), set `comp_plan: "pro"` (or `"solo"`) on `talkthru_billing/{uid}` in the Firebase console.
- Existing accounts that already have several live TalkThrus are not changed on release. Their next new TalkThru asks for a plan; if they later start and end a plan, the normal downgrade rule applies.

## Where it is enforced

- **Server (authoritative):** `generateBoardWizardBatch` refuses a new personal TalkThru over the limit before any generation; `teamCommand` refuses a second team publish on a free team and invites beyond paid seats; the `enforceTalkThruListingLimit` Firestore trigger pauses any personal TalkThru that becomes visible over the limit by any other path (old tabs, direct writes). Refusals carry `details.talkthruPlanRequired`, which the app turns into the plan picker.
- **App:** checks before opening the listing wizard, saving a wizard TalkThru, making a private TalkThru Public/Unlisted, and exporting a TalkThru video. Video rendering happens in the browser, so the video gate is app-side.

## Data (server-only; the default Firestore rule denies clients)

- `talkthru_billing/{uid}` and `talkthru_team_billing/{teamId}`: plan, cycle, Stripe status, seats, trial end, period end, cancel flags, Stripe customer/subscription IDs, optional `comp_plan`.
- `talkthru_trial_claims/{user_<uid>|email_<sha256>|team_<teamId>}`
- `talkthru_paused_boards/{boardId}`: owner, previous visibility, reason.
- `talkthru_config/stripe_<test|live>`: product, price and portal IDs saved by setup.
- `talkthru_billing_emails/{key}`: one record per reminder or failed-payment email, so Stripe retries never send twice.

The app reads everything through the `talkThruBillingCommand` callable (`status`, `checkout`, `confirm`, `portal`, and admin-only `setup`).

## Stripe: what is automatic

Nothing has to be created by hand in the Stripe dashboard.

- **Products and prices** come from the plan catalog in `functions/src/talkthru-plans.ts` (lookup keys `talkthru_<solo|pro|team>_<monthly|annual>`). The first checkout creates any that are missing. If a price in the catalog changes, the next setup run creates the new price, moves the lookup key, and retires the old one. Existing subscribers keep their old price until they change plans.
- **Billing portals**: separate personal (Solo ⇄ Pro, monthly ⇄ annual) and team (seats and cycle) configurations, so a team can never switch onto a personal price. They are created on first use and their IDs saved in `talkthru_config/stripe_<test|live>`. `STRIPE_TALKTHRU_PORTAL_CONFIGURATION` / `STRIPE_TALKTHRU_TEAM_PORTAL_CONFIGURATION` remain optional overrides.
- **Webhook events**: setup adds any missing TalkThru events to the existing `stripeBusinessWebhook` endpoint and keeps the events other features use.
- **Emails**: we send our own “free month ends on …” reminder (Stripe's `trial_will_end`, 3 days before) and a “payment didn't go through” email with a pay link, once per subscription/invoice, through SendGrid. The reminder promised in the plan picker does not depend on a dashboard setting.
- **Double checkouts**: a new checkout expires the person's previous unfinished one. If two still complete, the newer subscription is kept and the older is cancelled with proration.

## Release checklist

1. Deploy functions before hosting:
   `firebase deploy --only functions:talkThruBillingCommand,functions:enforceTalkThruListingLimit,functions:stripeBusinessWebhook,functions:generateBoardWizardBatch,functions:teamCommand --project living-atlas-7622a`
   (`stripeBusinessWebhook` now also uses the existing `SENDGRID_API_KEY` secret.)
2. Deploy hosting: `npm run build:hosting && firebase deploy --only hosting --project living-atlas-7622a`
3. Sign in as a platform admin → account menu → **TalkThru plan** → **Stripe setup** → **Set up / fix Stripe**. It uses the same Stripe key as production (`STRIPE_SECRET_KEY`), shows Test or Live mode, and reports **Ready** or exactly what is left. The only thing it cannot do is create a webhook endpoint from scratch, because its signing secret must be stored in Firebase. The existing endpoint already exists for the other plans.
4. Try it end to end: every plan starts with a free month, so a real checkout charges $0 today. Start a plan, confirm the wizard reopens, then cancel in **Manage billing**.
5. Optional, before using the live key: `STRIPE_SECRET_KEY=sk_test_… node functions/scripts/setup-talkthru-stripe.cjs` creates the same setup in a Stripe test account (`--check` only reports).

## Tests

- `npm --prefix functions run test:talkthru-billing` — plan rules, pricing, return-path safety, browser/server catalog parity.
- `npm --prefix functions run test:talkthru-billing-flow` — trigger, subscription sync, downgrade/upgrade, team publish/seat gates against an in-memory Firestore.
- `npm --prefix functions run test:talkthru-stripe` — Stripe setup (catalog, portals, webhook), checkout on a fresh account, plan switches, duplicate protection, billing emails, against an in-memory Stripe.

## Not built yet (on the pricing page from Jim's grid)

- Multilingual TalkThrus “in 30+ languages, still in your voice”: visitors can translate boards into 4 languages today, and translated live conversations do not use the agent's own voice.
- “Which rooms got replayed”: analytics count card opens, not replays.
- Neighborhood cards from LivingWiki local guides, live onboarding sessions, dedicated partner support: product or operations work, not gated in code.
