# TalkThrus landing page

The public landing page is available at `/talkthrus` on the LivingWiki domain. It recreates the LivingWiki TalkThrus preview page as a native Angular route; images are stored in `public/assets/talkthrus` and the example button opens the existing public board.

The signup form calls `submitTalkThruInterest`. It requires a name, work email, agency, and explicit contact consent. The function validates inputs, discards honeypot submissions, and limits repeated submissions from one IP address. Accepted requests are stored in the private `talkthru_interests` Firestore collection, which is denied to web clients by the default Firestore rules. Authorized project operators can review requests in the Firebase console. It does not send an email notification.

Publish the function before Hosting so the form has a destination when the page goes live:

```sh
firebase deploy --only functions:submitTalkThruInterest --project living-atlas-7622a
npm run build:hosting
firebase deploy --only hosting --project living-atlas-7622a
```
