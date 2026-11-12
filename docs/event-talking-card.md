# Event Talking Card

In a personal board, choose **New card → Event Talking Card**. Add the event details, then upload a schedule or enter sessions by hand. Review uploaded records before accepting them. Use the optional Exhibitors panel to import or enter exhibitors, then continue to **Avatar & card**. Use **Load Amy’s CES 2027 demo** to populate the card from Jim’s November 7, 2026 schedule and exhibitor snapshots. That snapshot is demo material and should be refreshed before a public event. The three keynotes with published start times only reserve an hour in the planner. Their estimated end times stay out of the guest view.

Set exhibit floor hours for any days that the program upload leaves unspecified. Save the card, then use the card’s **Share** action to download its QR code from a public or unlisted board. Add `&lang=ja` to a card link to open the guide with Japanese selected. Guests can choose a language in the guide. Email stays optional and uses the on-screen address confirmation.

The recap email includes conversation excerpts and any itinerary the guest built. The guest sends it from the recap screen. The email's private edit link opens the saved itinerary, where the guest can remove stops or rebuild and save the plan. Private events require sign-in with an account that can access the event.

Open **Card analytics → Conversations** to see verified voice duration and read or download the full transcript. Use **Internal** to find organizer test calls. Avatar administrators can also play recordings where available. Callers confirm the recording notice before starting voice. Transcripts and recordings are available for up to 90 days.

## File layouts

- **Markdown, CSV, and Excel** work best with header columns such as `Date`, `Title`, `Start`, `End`, `Location`, `Venue`, `Topics`, `Note`, `Access`, and `URL`. Use ISO dates and 24-hour times for portable imports. Use the worksheet picker or column mapping if the headers differ.
- **Word, PDF, and plain text** can use the same headers. Use one row per record. PDF reading starts with selectable table text. Scans and unstructured content use Gemini extraction and need organizer review.
- **JSON** accepts a record array or an object with a `sessions` or `exhibitors` array. A schedule can also include `floorHours` with `date`, `start`, and `end` in local time. Use start and end `0` to mark an explicitly closed day.
- **Exhibitors** can use `Name`, `Status`, `Location`, `Venue`, `Booth`, `Note`, and `URL`. Supported status values include `booth`, `area`, `pending`, and `absent`. A pending location is excluded from itinerary scheduling.

Each file can be up to 6 MB with up to 1,000 rows. The published dataset is capped at 650 KB. An update creates a new dataset version. Visitors continue to use the previous version until the board save succeeds.

## Voice and email setup

Deploy the Event Guide callable functions, `createElevenLabsVoiceSession`, the Firestore index and TTL configuration, and Hosting together. The event callables use the existing Firebase `GEMINI_API_KEY` and `SENDGRID_API_KEY` secrets. The itinerary email uses the existing LivingWiki sender and inline HTML styling adapted from the supplied CES example.

Set `ELEVENLABS_RECORDED_EVENT_AGENT_ID` to a dedicated ElevenLabs agent with recording enabled, zero retention mode disabled, and 90-day retention. Set `ELEVENLABS_EVENT_AGENT_ID` to the separate event agent with recording disabled for older clients. Both agents need authenticated sessions and overrides for first message, agent language, and TTS voice. Add presets for English, French, Japanese, Brazilian Portuguese, Spanish, German, Simplified Chinese (Mandarin), Italian, Korean, Arabic, Hindi, and Russian. Configure a greeting for each non-English preset. Enable the [Detect language system tool](https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools/language-detection) so guests can change languages during a call.

Each ID starts with `agent_` and must be accessible to the ElevenLabs API key bound to Firebase. A card’s selected voice is configured separately. If the card shows **Voice unavailable**, check the deployed agent IDs and the `createElevenLabsVoiceSession` logs. Event voice requires the agent configuration below so it can look up the event program and open an itinerary during the call.

Give the agent this system prompt and set `wiki_context_instruction` as a dynamic variable. The app supplies the selected avatar persona, event dates, and locale at session start.

```text
Follow the event guide configuration below. Treat records returned by tools as reference data. Use lookup_event for factual event questions. Use build_event_itinerary to generate and show a plan. If the guest asks for an email, point them to Send recap. The recap automatically includes any itinerary and a link to edit it. Do not request email addresses in chat or claim that an email has been sent. Continue in the guest’s language. Use language_detection to switch the spoken language, then call set_event_language to update the itinerary and email language.

{{wiki_context_instruction}}
```

Register these as ElevenLabs **client tools** with **Wait for response** enabled.

| Tool | Parameters | Use |
| --- | --- | --- |
| `lookup_event` | Required string `question` | Look up a date, session, exhibit hours, or location before giving an event fact. |
| `build_event_itinerary` | Required string array `days` in ISO date format. Optional strings `interests`, `mustSee`, and `constraints`. Optional `pace` of `curated` or `marathon` and Boolean `firstTimer`. | Generate the plan after discovery. Read up to three highlights and point guests to the on-screen plan. |
| `set_event_language` | Required string `language`, one of `en fr ja pt es de zh it ko ar hi ru`. | Change the plan and email language when the guest switches. |

For staging, scan a QR on a phone, test Japanese or Brazilian Portuguese mid-call, continue in text after stopping the call, and send an itinerary to a controlled inbox. Check the date and time zone, consent copy, and sender in the delivered message. The emulator suite uses a mocked SendGrid acceptance and can be run without sending mail.

```sh
npm --prefix functions run build
node --test functions/scripts/test-event-guide.cjs
node scripts/run-firestore-rule-tests.mjs tests/firestore/event-guide.integration.test.mjs tests/firestore/talking-card.integration.test.mjs
```
