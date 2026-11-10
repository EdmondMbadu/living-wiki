# Voice credits rollout

The switch starts Off. A super admin can turn it on under **Admin → Analytics → Voice limits**. Voice Usage appears under More while limits are on. Off stops new reservations and purchases, releases active relay deadlines, and excludes any time after the switch from credit charges. Existing balances and caps are saved for when limits are turned on again.

## Launch defaults

- Visitors get one sponsored session per public or unlisted board in a rolling 24-hour window. It lasts up to 3 minutes. A dropped connection can resume on the same avatar for the unused time within two minutes after settlement. Text remains available.
- Creators and teams get 60 included minutes across all their boards per UTC calendar month, with a default 20-minute cap per board. Both defaults are configurable. The included allowance is used first, then the account’s purchased credits. A signed-in visitor can choose to spend their own credits when sponsorship runs out, up to 10 minutes per session. They can start another session as long as they have credits.
- One credit equals one minute. Checkout sells a 60-credit pack at the configured Stripe price. The ledger tracks seconds, releases unused reserved time and carries purchased credits forward. Refunds remove the corresponding credits. A dispute blocks the credits until resolved and a lost dispute removes them.
- Public and unlisted Talking Cards are the scope. Wiki, private board, and unrelated voice flows keep their existing behavior. Super admins are exempt from voice-credit limits. Provider limits still apply.

## Configuration

1. Build `functions/Dockerfile.voice-relay` using `functions/` as the Docker context. Push the image to Artifact Registry and deploy it as a Cloud Run service in the Firebase project. Use a dedicated service account with Firestore read/write access, a one-hour request timeout, and a public HTTPS endpoint so browsers can upgrade to WebSockets. The upgrade requires a short-lived single-use Firestore ticket. The relay does not need the Stripe or ElevenLabs API key. Confirm `/healthz` returns `livingwiki-voice-relay`. [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)
2. Set these Firebase Functions parameters in the environment for the target project. Use a Stripe sandbox price in staging. Create a fixed, active, one-time Price in the same Stripe account and mode as the existing `STRIPE_SECRET_KEY`.

   | Parameter | Value |
   | --- | --- |
   | `VOICE_CREDITS_RELAY_URL` | HTTPS origin of the Cloud Run relay |
   | `VOICE_CREDITS_STRIPE_PRICE_ID` | Price ID for the 60-credit pack |
   | `VOICE_CREDITS_SUPER_ADMIN_UIDS` | Comma-separated Firebase Auth UIDs of the operators |

   Operators also need `users/{uid}.role` set to `admin`. The server accepts a Firebase custom claim `voiceCreditsSuperAdmin: true` in place of the UID allowlist. Never put the Stripe API key or webhook signing secret in a frontend build or relay environment.
3. Add `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created`, and `charge.dispute.closed` to the existing signed Stripe webhook for the target environment. Keep `checkout.session.completed` and all current subscriptions to events. Deploy the existing voice session and Stripe webhook functions along with the new callable and scheduled job. Deploy hosting after the callable is available. From the repository root, the targeted Functions deploy is `firebase deploy --only functions:createElevenLabsVoiceSession,functions:stripeBusinessWebhook,functions:voiceCreditsCommand,functions:reconcileVoiceCredits`. The app uses the existing `ELEVENLABS_API_KEY` and conversation agent configuration. The key needs permission to read conversation details for settlement.
4. Before enabling limits in production, turn them on in staging. If staging uses a different hostname, add its exact origin to `allowedCheckoutOrigins` in `functions/src/stripe-client.ts`. Use a non-admin visitor and a sandbox payment. Check that sponsored calls end on time, the Stripe return reopens the same avatar, a duplicate webhook leaves the balance unchanged, a paid call debits the visitor, and switching Off during a call clears the deadline and hides Voice Usage on the next menu open. Check that the reconciliation job runs and that signed webhook events are delivered successfully.

## Local verification

`npm run test:firestore-rules -- tests/firestore/voice-credits.integration.test.mjs` runs against the Firestore emulator with a local WebSocket provider and mocked Stripe. `npm run test:sponsorship` covers the Talking Card UI and existing sponsorship flows. These tests use no live voice or payment credentials.
