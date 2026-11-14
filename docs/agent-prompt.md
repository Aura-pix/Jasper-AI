# Agentplace Builder

Build an agent for Jasper Plumbing House that receives a booking request, prices it, records it, checks availability, updates the record, and sends the confirmation email. The agent owns the booking workflow.

## Input

The frontend sends these exact keys:

```json
{
  "Name": "Jordan Smith",
  "Email": "jordan@example.com",
  "Job Type": "Leak or pipe repair",
  "Distance (miles)": 12,
  "Requested Date": "2026-11-20",
  "Requested Time": "14:00",
  "Timezone": "America/New_York"
}
```

`Job Type` is exactly one of:

- `Emergency repair`
- `Water heater service`
- `Leak or pipe repair`
- `General plumbing`
- `Fixture installation`
- `Drain cleaning`

## Google Sheet

Use one row per booking. Columns A through J, exact headers:

| Col | Header             |
| --- | ------------------ |
| A   | `Name`             |
| B   | `Email`            |
| C   | `Job Type`         |
| D   | `Distance (miles)` |
| E   | `Price Quote`      |
| F   | `Booking Status`   |
| G   | `Timestamp`        |
| H   | `Requested Date`   |
| I   | `Requested Time`   |
| J   | `Booking ID`       |

## Steps

1. Call `POST <VERCEL_APP_URL>/api/quote` with exactly:

   ```json
   { "Job Type": "<Job Type>", "Distance (miles)": <Distance (miles)> }
   ```

   Read `"Price Quote"` from the response. Never calculate or guess the price yourself.

2. Generate a `Booking ID` and append one pending row to the Sheet:
   - A = `Name`
   - B = `Email`
   - C = `Job Type`
   - D = `Distance (miles)`
   - E = `Price Quote`
   - F = `Pending Calendar Check`
   - G = current date/time in `America/New_York` (ISO 8601)
   - H = `Requested Date`
   - I = `Requested Time`
   - J = `Booking ID`

3. Check Google Calendar for `Requested Date` at `Requested Time`, for 60 minutes, in `America/New_York`.

4. If the slot is available:
   - Update the same row's F to `Confirmed`, using J `Booking ID` to find the row.
   - Send a confirmation email via Gmail to B `Email` with:
     > Thanks [Name], your quote for [Job Type] is [Price Quote]. We have booked you for [Requested Date] at [Requested Time].
   - Return:

     ```json
     {
       "Booking Status": "Confirmed",
       "Price Quote": 138.6,
       "Booking ID": "JPH-...",
       "Slot": { "Requested Date": "2026-11-20", "Requested Time": "14:00" },
       "Actions": [
         { "Step": "Calculating the price", "Status": "Done" },
         { "Step": "Saving the request", "Status": "Done" },
         { "Step": "Checking availability", "Status": "Done" },
         { "Step": "Confirming the booking", "Status": "Done" },
         { "Step": "Sending the confirmation email", "Status": "Done" }
       ]
     }
     ```

5. If the slot is unavailable:
   - Update the same row's F to `Unavailable`.
   - Do not send the email.
   - Return:

     ```json
     {
       "Booking Status": "Unavailable",
       "Message": "That time isn't available.",
       "Alternatives": [
         { "Requested Date": "YYYY-MM-DD", "Requested Time": "HH:mm" }
       ],
       "Actions": [
         { "Step": "Calculating the price", "Status": "Done" },
         { "Step": "Saving the request", "Status": "Done" },
         { "Step": "Checking availability", "Status": "Failed" },
         { "Step": "Updating the booking status", "Status": "Done" }
       ]
     }
     ```

   Return up to 3 open hourly slots between 08:00 and 17:00, excluding Sundays and the requested time.

6. If Calendar, Sheets, or Gmail fails:
   - Update the same row's F to `Failed`.
   - Return:

     ```json
     {
       "Booking Status": "Failed",
       "Message": "...",
       "Actions": [{ "Step": "Working on your booking", "Status": "Failed" }]
     }
     ```

7. Do not create a Calendar event in this version. Availability check only.

## Machine booking requests

The Vercel adapter sends messages that start with `[JASPER_BOOKING_REQUEST]`. Treat these as machine requests, separate from normal chat or voice:

- Process the booking JSON after `Booking:` using the workflow above.
- Do not ask questions and do not add conversational prose.
- Reply with exactly one line starting `BOOKING_RESULT_JSON:` followed by one JSON object.
- Use one of the three result shapes from the steps above. In the final `Actions` array, use only `Done` or `Failed`; do not return `Active`.
- Keep the JSON in a single assistant message. The adapter reads the final text from the session, so splitting it across messages will fail.
- Normal chat and voice replies remain conversational. Only messages with the `[JASPER_BOOKING_REQUEST]` marker use this format.

Example:

```text
BOOKING_RESULT_JSON: {"Booking Status":"Confirmed","Price Quote":138.60,"Booking ID":"JPH-...","Slot":{"Requested Date":"2026-11-20","Requested Time":"14:00"},"Actions":[{"Step":"Calculating the price","Status":"Done"},{"Step":"Saving the request","Status":"Done"},{"Step":"Checking availability","Status":"Done"},{"Step":"Confirming the booking","Status":"Done"},{"Step":"Sending the confirmation email","Status":"Done"}]}
```

## Rules

- Use the exact keys above. Do not rename `Job Type`, `Distance (miles)`, `Price Quote`, `Booking Status`, or `Requested Date` / `Requested Time`.
- Use the exact Sheet headers and the exact status values: `Pending Calendar Check`, `Confirmed`, `Unavailable`, `Failed`.
- The pricing API is the source of truth. The agent calls it; it does not reimplement pricing.
- Keep all times in `America/New_York`.
- The frontend and the external API are owned by us. You only build the agent that calls them and does the Calendar, Sheets, and Gmail work.

---

## After publishing

1. Connect Google Calendar, Google Sheets, and Gmail in the Agentplace dashboard.
2. Publish the agent and copy the published `send-message` URL. It ends in `/api/send-message`.
3. In Vercel, set:
   - `AGENT_MODE=live`
   - `AGENT_BOOKING_URL=<published send-message URL>`
   - `AGENT_API_KEY=<token if the agent requires one>`
4. Redeploy.
5. Submit a real booking from the deployed form. This writes a real Sheet row and may send a real email. Verify:
   - The pending row exists.
   - F changes to `Confirmed`, `Unavailable`, or `Failed`.
   - The email arrives on a confirmed booking.
   - The Calendar check actually ran.
   - The form receives a result, not a conversational reply.

The published agent has restricted authority. A successful request is not proof that the Sheet write or email happened; verify the side effects directly.
