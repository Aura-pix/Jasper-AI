# Submission note — draft

Fill in the links before sending.

## What I built

A booking flow for Jasper Plumbing House:

form → `/api/quote` (price) → `/api/book` (agent relay + action stream) → Agentplace agent → Google Calendar, Google Sheets, Gmail.

The customer enters `Name`, `Email`, `Job Type`, `Distance (miles)`, `Requested Date`, and `Requested Time`. The form shows a price preview before the booking request. The agent then calculates the final price, writes a pending row to the Sheet, checks Calendar, updates the row to `Confirmed`, and sends the email. The frontend renders the agent's action log and the result.

The agent is the application. The frontend does not own the booking workflow and does not simulate the live agent's stages. It sends the exact-key request and renders whatever the agent reports.

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

- Deployed app: `<VERCEL_URL>`
- Pricing endpoint: `<VERCEL_URL>/api/quote`
- GitHub repo: `<GITHUB_URL>`

## Exact-key contract

The form, the agent, and the Sheet use the same header strings. There is no camelCase or job-type ID mapping.

Sheet columns:

`Name | Email | Job Type | Distance (miles) | Price Quote | Booking Status | Timestamp | Requested Date | Requested Time | Booking ID`

The form fills A–D plus H/I. The agent fills E/F/G/J and updates F. The email and the Sheet use the same service labels and the same price key. This removes the class of failure where the form sends one name and the Sheet expects another.

## Agentplace boundary

The Agentplace Builder generates and hosts the agent from our prompt. The exact prompt is in `docs/agent-prompt.md`. We own the prompt, the API contract, the pricing function, the frontend, and the repository. The agent's job is the workflow: quote, pending row, Calendar check, status update, and Gmail confirmation.

This kept the generated agent focused. The agent calls our API instead of reimplementing pricing, and the frontend renders the agent's action log instead of hardcoding the booking steps.

## Availability

Availability belongs to the agent because that is where the Google Calendar authorization lives. Vercel never holds Calendar credentials. The agent checks the requested slot. If it is unavailable, it updates the row to `Unavailable` and returns alternatives; the frontend shows them. If it is available, the agent updates the row to `Confirmed` and emails the customer.

The mock agent marks Sundays and 12:00 PM as booked so the unavailable path can be tested before the live agent exists. Switching to live is an environment change (`AGENT_MODE=live` and `AGENT_BOOKING_URL`), not a frontend rewrite.

## Platform limits

- The published Agentplace agent has restricted authority. It can write to Sheets and send Gmail, but the side effects need to be tested directly. A successful agent response is not proof that the Sheet row or email exists.
- The agent endpoint may not expose granular per-step progress. The live proxy relays the agent's final result; the mock streams the same action contract for local development. If Agentplace supports streaming, the proxy can relay it.
- The mock agent is deterministic: Sundays and 12:00 PM are unavailable. The live agent uses Calendar.
- The SSE route is capped at 60 seconds on Vercel.
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

- Published agent: `<AGENTPLACE_URL>`
- GitHub repo: `<GITHUB_URL>`
- Deployed form: `<VERCEL_URL>`