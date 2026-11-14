# Booking workflow specification

## Customer request

The frontend supplies these exact required fields:

```json
{
  "Name": "Sample Customer",
  "Email": "customer@example.invalid",
  "Job Type": "Leak or pipe repair",
  "Distance (miles)": 12,
  "Requested Date": "2026-11-20",
  "Requested Time": "14:00",
  "Timezone": "America/New_York"
}
```

Allowed `Job Type` values are exactly: `Emergency repair`, `Water heater service`, `Leak or pipe repair`, `General plumbing`, `Fixture installation`, and `Drain cleaning`. `Timezone` is `America/New_York`; date is `YYYY-MM-DD`; time is 24-hour `HH:mm`. Ask for missing or invalid values; never infer them.

## Appointment window

- Appointments are offered Monday through Saturday from 08:00 to 18:00 Eastern Time. Supported one-hour starts are on the hour from 08:00 through 17:00; Sunday appointments are unavailable.
- These are operating hours, not confirmation that a particular calendar slot is open. The current workflow checks Calendar only as part of a customer-authorized booking request and will save and email when the requested slot is confirmed. Do not invoke it for an hours or availability-only question.
- A non-Sunday request outside the supported start times returns `Unavailable` before any quote request, Sheet write, Calendar query, or email. It creates no booking record. It must be corrected to an eligible time before a booking request can proceed.

## Authoritative booking data

- Quote: `POST https://example.invalid/api/quote` with only `{"Job Type": <Job Type>, "Distance (miles)": <Distance (miles)>}`. This URL is a placeholder; configure an owner-controlled pricing endpoint in an authorized environment. Use the finite numeric `Price Quote` returned by the endpoint without recalculating it.
- Booking ID: generated with the `JPH-` prefix.
- Timestamp: current ISO 8601 date/time in `America/New_York`.
- Booking sheet: use the owner-configured spreadsheet ID `REPLACE_WITH_SPREADSHEET_ID` for the `Jasper Plumbing House` sheet; do not rely on a Drive name search. Require exactly one tab whose first row A–J matches the headers below. Do not create or alter sheets or headers. The connected Google Sheets account must have Editor access; public view access alone is not enough to write booking rows. If the target is unreadable, unwritable, or mismatched, fail without claiming a booking.
- Exact headers A–J: `Name`, `Email`, `Job Type`, `Distance (miles)`, `Price Quote`, `Booking Status`, `Timestamp`, `Requested Date`, `Requested Time`, `Booking ID`.
- Exact statuses: `Pending Calendar Check`, `Confirmed`, `Unavailable`, `Failed`.

## Sequence and outcomes

1. Validate the local date/time and that it is in the future. For a non-Sunday time outside the supported appointment starts, return the out-of-hours result below without making external calls or creating a booking ID.
2. For an eligible request, obtain the quote.
3. Upsert one complete row with `Pending Calendar Check`, using `Booking ID` as the key.
4. If the requested date is Sunday, update the same row to `Unavailable` with the message `Sunday appointments are unavailable.`; do not query Calendar or send email. Return an empty `Alternatives` list because no weekday openings were checked, and mark the Sunday-closure and status-update actions `Done`.
5. For an in-hours non-Sunday date, query the configured primary Google Calendar by its configured ID `REPLACE_WITH_PRIMARY_CALENDAR_ID` (not the `primary` alias) for the requested 60-minute slot in `America/New_York`; do not create an event.
6. If available, update the same row to `Confirmed`, then send a plain-text Gmail confirmation to `Email` with exactly: `Thanks [Name], your quote for [Job Type] is $[Price Quote]. We have booked you for [Formatted Appointment Date/Time].` Prefix the exact quote returned by the API with `$` without rounding. Format the local appointment as weekday, ordinal day, full month, year, and 12-hour time with lowercase `am`/`pm` (for example, `Monday, 16th November 2026 at 9am`). Compute the weekday from the actual date. Do not append a Gmail signature.
7. If unavailable, update the row to `Unavailable`, send no email, and return up to three open hourly alternatives. Search the 30 calendar dates starting with the requested date, with alternative starts 08:00–17:00, excluding Sundays and the requested date/time slot.
8. If a Sheet, Calendar, or Gmail operation fails after the row is located, attempt to set the same booking row to `Failed` using its `Booking ID`. For an uncertain pending-row write, retry the full row with `Failed` so recovery cannot create a partial status-only row. Never retry an uncertain email automatically. If the final record or email outcome cannot be verified, say so; do not claim success.

## Internal result contracts

- Unavailable outside the appointment window: `Booking Status: "Unavailable"`, a truthful message stating the allowed schedule and that no booking was processed, `Alternatives: []`, and one `Done` action for applying the appointment-hours policy. No quote, booking ID, record, Calendar query, or email is produced.
- Confirmed: `Booking Status`, numeric `Price Quote`, full `Booking ID`, `Booking Reference` containing the exact final six characters of that ID, `Slot` with `Requested Date` and `Requested Time`, and the five `Actions` (`Calculating the price`, `Saving the request`, `Checking availability`, `Confirming the booking`, `Sending the confirmation email`) each marked `Done`. The reference is computed by the tool so the assistant can use it verbatim without re-slicing the full ID.
- Unavailable for a non-Sunday calendar slot: `Booking Status: "Unavailable"`, `Message: "That time isn't available."`, `Alternatives` containing only returned `Requested Date`/`Requested Time` pairs, and four `Actions`: price and saving `Done`, availability `Failed`, and status update `Done`.
- Unavailable for Sunday: `Booking Status: "Unavailable"`, `Message: "Sunday appointments are unavailable."`, `Alternatives: []`, and four `Actions`: price and saving `Done`, Sunday closure `Done`, and status update `Done`.
- Failed: `Booking Status: "Failed"`, a truthful `Message`, and one `Action`: `Working on your booking` marked `Failed`.

These JSON objects are authoritative workflow results. For ordinary chat and voice, the assistant explains outcomes in concise natural language and never displays raw JSON, internal actions, or status metadata. For a website-form request whose message begins with `[JASPER_BOOKING_REQUEST]`, the final assistant response is a transport contract for the form adapter: one line beginning `BOOKING_RESULT_JSON:` followed by the complete JSON result object, with no Markdown or surrounding prose. The form adapter consumes that line and renders the customer-facing card; it must not expose raw JSON. Preserve every returned result field, especially `Booking Status`, `Message`, `Price Quote`, `Booking ID`, `Booking Reference`, `Slot`, `Alternatives`, and `Actions`; do not invent, omit, or change authoritative values. Unavailable results retain the exact alternatives returned by the workflow and send no email. For a confirmed booking in ordinary chat/voice, use a short message that states the verified appointment date/time and that a confirmation email will arrive; do not add the quote, booking reference, or full Booking ID unless the customer asks. When a reference is requested, use the workflow's exact `Booking Reference` value; never expose the full Booking ID unless the customer explicitly requests the complete identifier. The confirmation email itself contains the exact quote prefixed with `$` and the human-readable appointment date/time described above. Never claim a booking or email was completed unless the workflow confirms it.
