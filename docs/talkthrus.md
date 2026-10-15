# TalkThrus landing page

The public landing page is available at `/talkthrus` on the LivingWiki domain. It recreates the LivingWiki TalkThrus preview page as a native Angular route; images are stored in `public/assets/talkthrus` and the example button opens the existing public board.

The header and footer use Jim’s supplied TalkThrus logo (`talkthrus-logo.png`). The 22-second introduction sits immediately after the hero benefits, before the longer product explanation, and the hero’s “Watch the video” link jumps to `/talkthrus#video`. The original captioned MP4 is served locally as `talkthrus-introduction.mp4`, with a first-frame JPEG poster. The square player preserves the complete frame, uses native controls and inline mobile playback, and waits for user interaction before loading the video. A direct MP4 link remains available below it, including when playback fails. The surrounding copy is localized; the video’s audio and baked-in captions remain English and are labeled accordingly.

Section links use the locale base URL so navigation within a translated TalkThrus page keeps the selected language.

The signup form calls `submitTalkThruInterest`. It requires a name, work email, agency, and explicit contact consent. The function validates inputs, discards honeypot submissions, and limits repeated submissions from one IP address. Accepted requests are stored in the private `talkthru_interests` Firestore collection, which is denied to web clients by the default Firestore rules. Authorized project operators can review requests in the Firebase console. It does not send an email notification.

Publish the function before Hosting so the form has a destination when the page goes live:

```sh
firebase deploy --only functions:submitTalkThruInterest --project living-atlas-7622a
npm run build:hosting
firebase deploy --only hosting --project living-atlas-7622a
```

Pricing, checkout and plan limits are documented in [talkthru-billing.md](talkthru-billing.md).
