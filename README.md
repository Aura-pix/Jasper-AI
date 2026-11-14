# Jasper Plumbing House — booking demo

A booking flow for a plumbing service: get an estimate, request an appointment, and watch the agent complete the booking. The Next.js frontend and the pricing API live in this repo. The Google Calendar, Google Sheets, and Gmail work is done by an Agentplace agent generated from our prompt in [`docs/agent-prompt.md`](docs/agent-prompt.md).

The agent is the application. The frontend sends the request and renders the agent's action log and result. Vercel provides the form and one capability, the price quote. The mock agent exists so the UI can be developed before the published agent is wired up; it mirrors the same contract.

The original assessment brief is preserved in [`docs/agentplace-brief.md`](docs/agentplace-brief.md), and the submission note draft is in [`docs/submission-note.md`](docs/submission-note.md).

## Flow

1. Customer enters `Name`, `Email`, `Job Type`, `Distance (miles)`, `Requested Date`, and `Requested Time`.
2. The form calls `/api/quote` and shows the synchronous price preview.
3. The customer requests the booking. The form posts the exact-key request to `/api/book`.
4. In mock mode, `/api/book` simulates the agent and streams its actions. In live mode, it posts a machine booking request to the Agentplace `send-message` endpoint, waits for the agent's structured result, and relays that result.
5. The agent calculates the price, writes a pending row to the Sheet, checks Calendar, updates the row to `Confirmed`, and sends the email.
6. The frontend renders the agent's action log, the confirmation, or the agent's unavailable/failure response.

## Who owns what

| Layer | Responsibility |
| --- | --- |
| `app/api/quote` | Pricing only. No calendar credentials, no side effects. |
| `app/api/book` | Validates the exact-key request, streams the mock agent's actions, or runs the live Agentplace adapter and relays the result. |
| `components/booking-form.tsx` | Form, price preview, agent action log, unavailable/retry states, confirmation. |
| Agentplace agent | The booking workflow: price lookup, pending Sheet row, Calendar check, status update, Gmail confirmation. Generated from our prompt, hosted by Agentplace. |

The Agentplace Builder writes and hosts the agent. We own the prompt, the contract, the pricing logic, the frontend, and the repository, so the generated agent stays small and predictable.

## Embedded agent

The published agent is embedded on the site through `app/layout.tsx`:

- `src="https://agentplace.io/admin/embed/v1.js"`
- `data-agent-url="https://bobmetsnbddq.run.agentplace.io/"`
- `data-controls="input"`

The structured form remains the booking path. The embed adds the conversational agent surface, and both use the same published agent.

## The exact-key contract

The form, the agent, and the Sheet use the same header strings. There is no camelCase or job-type ID mapping.

### Sheet schema

| Col | Header | Filled by | Example |
| --- | --- | --- | --- |
| A | `Name` | Customer | Jordan Smith |
| B | `Email` | Customer | jordan@example.com |
| C | `Job Type` | Customer | Leak or pipe repair |
| D | `Distance (miles)` | Customer | 12 |
| E | `Price Quote` | Agent | 138.60 |
| F | `Booking Status` | Agent | `Pending Calendar Check` → `Confirmed` / `Unavailable` / `Failed` |
| G | `Timestamp` | Agent | `2026-11-13T21:00:00-05:00` |
| H | `Requested Date` | Customer | 2026-11-20 |
| I | `Requested Time` | Customer | 14:00 |
| J | `Booking ID` | Agent | `JPH-...` |

The ready Sheet keeps A–G exactly as created and adds H `Requested Date`, I `Requested Time`, and J `Booking ID`.

### Form → agent payload

```json
{
  "Name": "Jordan Smith",
  "Email": "jordan@example.com",
  "Job Type": "Leak or pipe repair",
  "Distance (miles)": 12,
  "Requested Date": "2026-11-20",
  "Requested Time": "14:00"
}
```

The agent fills `Price Quote`, `Booking Status`, `Timestamp`, and `Booking ID`, and uses `Booking ID` to update the same row from pending to confirmed.

The live adapter adds `"Timezone": "America/New_York"` to the machine message. The form itself still sends only the six customer fields.

## Pricing

| Job Type | Multiplier |
| --- | --- |
| Emergency repair | 1.75 |
| Water heater service | 1.60 |
| Leak or pipe repair | 1.40 |
| General plumbing | 1.35 |
| Fixture installation | 1.25 |
| Drain cleaning | 1.20 |

Formula: `(75.00 + 2.00 × miles) × multiplier`, rounded to cents. Distance is 1–50 miles. The estimate covers call-out and labor; parts are quoted separately. The rate card lives in [`lib/pricing.ts`](lib/pricing.ts) and is covered by Vitest.

Example: 12 miles, leak repair → `(75 + 24) × 1.40 = $138.60`.

The pasted four service names map to ours: Leaky Faucet → Fixture installation, Clogged Drain → Drain cleaning, Water Heater Install → Water heater service, Emergency Call → Emergency repair.

## API contracts

### `POST /api/quote`

Request:

```json
{ "Job Type": "Leak or pipe repair", "Distance (miles)": 12 }
```

Response:

```json
{
  "Price Quote": 138.6,
  "Currency": "USD",
  "Breakdown": {
    "Call-out fee": 75,
    "Travel": 24,
    "Distance (miles)": 12,
    "Job Type": "Leak or pipe repair",
    "Rate": 1.4
  }
}
```

Errors return `400` with `{ "error": "...", "fields": { ... } }`, using the same exact keys.

### `POST /api/book`

Request:

```json
{
  "Name": "Jordan Smith",
  "Email": "jordan@example.com",
  "Job Type": "Leak or pipe repair",
  "Distance (miles)": 12,
  "Requested Date": "2026-11-20",
  "Requested Time": "14:00"
}
```

The response is an SSE stream of agent actions followed by the result:

```text
event: action
data: {"Step":"Calculating the price","Status":"Active"}

event: action
data: {"Step":"Calculating the price","Status":"Done"}

event: result
data: {"Booking Status":"Confirmed","Price Quote":138.6,"Booking ID":"JPH-...","Slot":{"Requested Date":"2026-11-20","Requested Time":"14:00"},"Actions":[...]}
```

Result variants:

```json
{
  "Booking Status": "Confirmed",
  "Price Quote": 138.6,
  "Booking ID": "JPH-...",
  "Slot": { "Requested Date": "2026-11-20", "Requested Time": "14:00" },
  "Actions": [{ "Step": "Calculating the price", "Status": "Done" }]
}
```

```json
{
  "Booking Status": "Unavailable",
  "Message": "That time isn't available.",
  "Alternatives": [{ "Requested Date": "2026-11-20", "Requested Time": "13:00" }],
  "Actions": [{ "Step": "Checking availability", "Status": "Failed" }]
}
```

```json
{
  "Booking Status": "Failed",
  "Message": "We couldn't confirm this booking.",
  "Actions": [{ "Step": "Working on your booking", "Status": "Failed" }]
}
```

Booking validation errors return `400` with exact field keys before the stream starts.

### Live agent request

`AGENT_BOOKING_URL` is the published agent's `POST /api/send-message` URL:

```dotenv
AGENT_BOOKING_URL=https://bobmetsnbddq.run.agentplace.io/api/send-message
```

The live adapter in `lib/agent-client.ts` does four things:

1. Posts a `[JASPER_BOOKING_REQUEST]` machine message containing the exact-key booking plus `"Timezone": "America/New_York"` and the required response schema to `send-message`.
2. Reads the `202` response: `{ "sessionKey": "...", "responseId": "...", "accepted": true }`.
3. Connects to `wss://<agent-host>/ws?agent_session_id=<sessionKey>`, queries the session content, and waits for the final assistant text with the matching `responseId`. It falls back to the last assistant text containing the result marker if the response id differs.
4. Extracts the `BOOKING_RESULT_JSON:` object and normalizes it into the result the form expects.

This adapter is necessary because `send-message` is asynchronous. It returns `202` and processes the turn in the background; it does not return the booking result in the HTTP response. The agent's normal chat and voice replies stay conversational. Only form submissions use the machine marker.

The agent must support the machine request mode described in [`docs/agent-prompt.md`](docs/agent-prompt.md).

### Live test

One deliberate end-to-end booking passed:

- Request: `Live Test Booking` / `live-test@example.com` / `Drain cleaning` / `10` miles / `2026-11-24` at `14:00`
- Result: `Confirmed`, `Price Quote` `114`, `Booking ID` `JPH-EAC67A5F-5F01-45D4-AC40-FF501BAC2962`, slot `2026-11-24` at `14:00`
- The agent wrote the pending row, updated it to `Confirmed`, ran the Calendar check, and sent the email.
- The test email address is reserved, so delivery was not verified. The Sheet row is the evidence to check.

## Agent workflow

1. Receive the six exact-key fields plus `Timezone`. The adapter adds `"Timezone": "America/New_York"` to the machine message.
2. Call `/api/quote` with `"Job Type"` and `"Distance (miles)"`. Use the returned `"Price Quote"`.
3. Append a pending row: A–D + H/I from the request, E price, F `Pending Calendar Check`, G timestamp, J booking ID.
4. Check Google Calendar for the requested slot in `America/New_York`.
5. If available: update F to `Confirmed`, send the email, return `Confirmed` with the price, slot, booking ID, and action log.
6. If unavailable: update F to `Unavailable`, return alternatives, do not send email.
7. If Calendar, Sheets, or Gmail fails: update F to `Failed`, return `Failed` with the message.

The email uses the actual confirmed slot:

> Thanks [Name], your quote for [Job Type] is [Price Quote]. We have booked you for [Requested Date] at [Requested Time].

The agent returns an `Actions` array. The frontend renders whatever the agent reports. If Agentplace streams actions, we relay them; if not, the UI shows a working state and then the final action log. The live proxy does not invent a stage timeline.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. No environment variables are required in mock mode. The mock marks Sundays and 12:00 PM unavailable so the unavailable path can be tested.

To configure live mode:

```bash
copy .env.example .env.local
```

```dotenv
AGENT_MODE=live
AGENT_BOOKING_URL=https://your-agent.example.com/api/send-message
AGENT_API_KEY=
```

`AGENT_API_KEY` is optional and is sent as `Authorization: Bearer <token>` when set.

## Scripts

```bash
npm run dev        # local development
npm run test       # Vitest
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint
npm run build      # production build
npm run start      # production server
```

The tests cover the rate card, exact-key validation, and the mock availability/alternatives logic. Run `npm run test && npm run typecheck && npm run lint && npm run build` before shipping.

## Deploy

1. Add H `Requested Date`, I `Requested Time`, and J `Booking ID` to the ready Sheet. Keep A–G exactly as they are.
2. Push this repo to GitHub.
3. Create a Vercel project from the repo and deploy. `/api/quote` and `/api/book` are part of the same deployment.
4. Publish the Agentplace agent using the prompt in [`docs/agent-prompt.md`](docs/agent-prompt.md). Use the deployed `/api/quote` URL.
5. Authorize Google Calendar, Google Sheets, and Gmail in Agentplace.
6. Set `AGENT_MODE=live`, `AGENT_BOOKING_URL` (the `send-message` URL), and `AGENT_API_KEY` in Vercel, then redeploy.
7. Submit a booking and verify the pending row, the status update, the email, and the Calendar check.

`/api/book` streams for up to 60 seconds (`maxDuration = 60`). The live adapter uses an 8-second request timeout and a 50-second WebSocket wait, so keep the agent turn within that window.

## Production next steps

- Replace the Google Sheet with Postgres for durable bookings and queryable status.
- Add Stripe for deposits or payment links.
- Add authentication and rate limiting on `/api/quote` and `/api/book`.
- Collect service address and phone number; derive distance from a maps API.
- Create the Calendar event after confirmation, not just the availability check.
- Move job status to a durable store if polling survives the SSE stage.
- Add SMS notifications and an owner-facing schedule view.

## Notes and limits

- This is an assessment demo, not a production booking system.
- The mock agent simulates the Sheet row, the status update, and the email. It does not touch Google services.
- Address and phone are intentionally omitted for this assessment.
- The mock uses New York business hours (`America/New_York`) and hourly slots from 8:00 AM to 5:00 PM. Appointments are one hour, so the last start is 5:00 PM.
- The published Agentplace agent has restricted authority. Test that the Sheet append/update and Gmail send actually complete; do not assume a 200 response means the side effects happened.
- `AGENT_BOOKING_URL` must be the `POST /api/send-message` URL, not the agent page URL. The adapter derives the `/ws` session URL from the same host.
- `send-message` is asynchronous. The adapter uses the session WebSocket `content.query` method to wait for the final assistant text. If Agentplace adds a synchronous or webhook result endpoint, replace that wait in `lib/agent-client.ts`.
- The form ignores conversational agent replies. The agent must return the `BOOKING_RESULT_JSON:` line described in `docs/agent-prompt.md`.
- The Agentplace embed script in `app/layout.tsx` loads the conversational agent on the site. The structured form still uses `/api/book`.
- `agentplace-reference/` is a sanitized reference snapshot of the agent source. It is excluded from the Next.js TypeScript and ESLint build because it is not part of the deployed app.
- A live booking test writes a real Sheet row and may send a real email. Run it deliberately, not as part of a generic smoke test.