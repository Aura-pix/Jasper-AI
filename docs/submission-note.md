# Submission note

## What I built

A booking flow for Jasper Plumbing House:

form → `/api/quote` (price) → `/api/book` (Agentplace adapter) → Agentplace `send-message` + session WebSocket → Google Calendar, Google Sheets, Gmail.

The customer enters `Name`, `Email`, `Job Type`, `Distance (miles)`, `Requested Date`, and `Requested Time`. The form shows a price preview before the booking request. The agent then calculates the final price, writes a pending row to the Sheet, checks Calendar, updates the row to `Confirmed`, and sends the email. The frontend renders the agent's action log and the result.

The agent is the application. The frontend does not own the booking workflow and does not simulate the live agent's stages. It sends the exact-key request and renders whatever the agent reports.

The published agent is also embedded on the site, so the same agent is available as a conversational surface alongside the structured form.

## The external API

`POST /api/quote` is the pricing capability. It accepts the exact keys:

```json
{ "Job Type": "Leak or pipe repair", "Distance (miles)": 12 }
```

and returns:

```json
{ "Price Quote": 138.60, "Currency": "USD", "Breakdown": { ... } }
```

The rate card is `$75` call-out plus `$2.00/mile`, multiplied by the job-type rate. It is covered by Vitest. The agent calls this endpoint for the final price; the frontend calls the same endpoint for the preview. Pricing logic lives in one place, and the agent is not allowed to invent a price.

- Deployed app: `https://jasper-ai-five.vercel.app/`
- Pricing endpoint: `https://jasper-ai-five.vercel.app/api/quote`
- GitHub repo: `https://github.com/Aura-pix/Jasper-AI`

## Exact-key contract

The form, the agent, and the Sheet use the same header strings. There is no camelCase or job-type ID mapping.

Sheet columns:

`Name | Email | Job Type | Distance (miles) | Price Quote | Booking Status | Timestamp | Requested Date | Requested Time | Booking ID`

The form fills A–D plus H/I. The agent fills E/F/G/J and updates F. The email and the Sheet use the same service labels and the same price key. This removes the class of failure where the form sends one name and the Sheet expects another.

## Agentplace boundary

The Agentplace Builder generates and hosts the agent from our prompt. The exact prompt is in `docs/agent-prompt.md`. We own the prompt, the API contract, the pricing function, the frontend, and the repository. The agent's job is the workflow: quote, pending row, Calendar check, status update, and Gmail confirmation.

This kept the generated agent focused. The agent calls our API instead of reimplementing pricing, and the frontend renders the agent's action log instead of hardcoding the booking steps.

## Live adapter

The published agent exposes `POST /api/send-message`. It is asynchronous: it returns `202 Accepted` with `{ sessionKey, responseId, accepted }` and processes the turn in the background. It does not return the booking result in the HTTP response.

`/api/book` handles that in `lib/agent-client.ts`:

1. It formats the exact-key booking as a `[JASPER_BOOKING_REQUEST]` message and posts it to `send-message`.
2. It reads the `sessionKey` and `responseId` from the `202`.
3. It connects to `wss://<agent-host>/ws?agent_session_id=<sessionKey>` and queries the session content.
4. It waits for the final assistant text with the matching `responseId`.
5. It extracts the `BOOKING_RESULT_JSON:` object and normalizes it into the response the form expects.

The agent's normal chat and voice replies stay conversational. Only form submissions use the machine marker and structured result. This keeps the agent as the application while giving the form a reliable result.

## What I published

- Published the agent at `https://bobmetsnbddq.run.agentplace.io`.
- Connected Google Calendar, Google Sheets, and Gmail in Agentplace.
- Embedded the published agent on the Next.js site with the Agentplace embed script in `app/layout.tsx` (`data-agent-url="https://bobmetsnbddq.run.agentplace.io/"`, `data-controls="input"`).
- Kept the structured form as the booking path. The embed is the conversational surface; both surfaces use the same published agent.

## Live test

I ran one deliberate end-to-end booking against the published agent:

- Request: `Live Test Booking`, `live-test@example.com`, `Drain cleaning`, `10` miles, `2026-11-24` at `14:00`.
- Result: `Confirmed`, `Price Quote` `114`, `Booking ID` `JPH-EAC67A5F-5F01-45D4-AC40-FF501BAC2962`, slot `2026-11-24` at `14:00`.
- The agent wrote the pending row, changed `Booking Status` to `Confirmed`, ran the Calendar check, and sent the email.
- The test email address is reserved, so delivery was not verified. The Sheet row is the evidence to check.

## Availability

Availability belongs to the agent because that is where the Google Calendar authorization lives. Vercel never holds Calendar credentials. The agent checks the requested slot. If it is unavailable, it updates the row to `Unavailable` and returns alternatives; the frontend shows them. If it is available, the agent updates the row to `Confirmed` and emails the customer.

The mock agent marks Sundays and 12:00 PM as booked so the unavailable path can be tested before the live agent exists. Switching to live is an environment change (`AGENT_MODE=live` and `AGENT_BOOKING_URL`), not a frontend rewrite.

## Platform limits

- The published Agentplace agent has restricted authority. It can write to Sheets and send Gmail, but the side effects need to be tested directly. A successful agent response is not proof that the Sheet row or email exists.
- `send-message` has no synchronous structured result and no documented webhook in the published endpoint, so the adapter holds a session WebSocket open and polls `content.query` for the final text. This is the main platform workaround. A production version would prefer a webhook or a synchronous JSON endpoint.
- The agent must return the exact `BOOKING_RESULT_JSON:` line for form submissions. Conversational replies are not parsed.
- The mock agent is deterministic: Sundays and 12:00 PM are unavailable. The live agent uses Calendar.
- The SSE route is capped at 60 seconds on Vercel. The adapter uses a 20-second send-message timeout and a 35-second WebSocket wait.
- The Sheet has ten columns. The agent updates the same row via `Booking ID`.

## Production changes

- Replace the Google Sheet with Postgres for durable bookings and a queryable status.
- Add Stripe for deposits or payment links.
- Add authentication and rate limiting on the pricing and booking endpoints.
- Collect a real service address and phone number; derive distance from a maps API.
- Create the Calendar event after confirmation instead of only checking availability.
- Add owner notifications and a schedule view.
- Add idempotency on the booking ID so retries do not duplicate Sheet rows.

## Links

- Published agent: `https://bobmetsnbddq.run.agentplace.io`
- Send-message endpoint: `https://bobmetsnbddq.run.agentplace.io/api/send-message`
- Agent embed: `https://agentplace.io/admin/embed/v1.js`
- GitHub repo: `https://github.com/Aura-pix/Jasper-AI`
- Deployed form: `https://jasper-ai-five.vercel.app/`
