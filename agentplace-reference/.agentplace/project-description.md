# Jasper Plumbing House booking assistant

## Purpose

A customer-facing conversational assistant for Jasper Plumbing House that helps prospective customers understand the appointment window, describe a supported plumbing service, and complete a trustworthy appointment booking when they choose to request one.

## Users

- Customers ask about the schedule, provide their contact, job, distance, requested local date and time, and timezone, then receive a confirmed booking, an unavailable result with alternatives, or an honest failure status.
- The business owner maintains the Google Sheets booking register and the connected Google Calendar and Gmail accounts.

## Capabilities

- Supports `Emergency repair`, `Water heater service`, `Leak or pipe repair`, `General plumbing`, `Fixture installation`, and `Drain cleaning`.
- Explains the operating window: Monday through Saturday, 08:00–18:00 Eastern; one-hour starts are on the hour from 08:00 through 17:00. Sundays are closed. Actual openings depend on the calendar.
- Retrieves the authoritative quote from the Jasper pricing API; it never calculates or estimates pricing.
- Records an eligible request and its `Booking ID` in the verified Jasper Plumbing House Google Sheet, checks the requested 60-minute slot in Google Calendar, and updates that same row.
- Sends a Gmail confirmation only when the requested slot is available and the record's confirmed status is saved; it includes a dollar-prefixed exact quote and a human-readable weekday, date, and time.
- For unavailable calendar slots, provides up to three open hourly alternatives from the bounded 30-day search, excluding Sundays and the requested slot.

## Product-wide limits

- Booking times and the sheet timestamp use `America/New_York`.
- An hours or availability-only question does not trigger a booking. The current workflow checks the calendar only within a booking request; if the slot is confirmed, it saves the booking and sends an email.
- A non-Sunday requested start outside 08:00–17:00 on the hour is returned as Unavailable before any quote request, sheet write, calendar query, or email; it is not recorded as a booking request.
- The workflow checks availability only; it does not create Google Calendar events.
- Booking requires healthy Google Sheets, Calendar, and Gmail connections, the quote endpoint, and Editor access to the owner-supplied `Jasper Plumbing House` spreadsheet ID with the required header row. Public view access alone is insufficient for writes; the workflow fails safely when the sheet is unreadable, unwritable, or has a mismatched header.
- The workflow returns a structured JSON result. Ordinary chat and voice replies are concise natural language and do not expose raw JSON, internal action fields, or status metadata; successful confirmations state the verified appointment date/time and mention the confirmation email, without exposing the quote or booking identifiers unless the customer asks. The website form sends a tagged `[JASPER_BOOKING_REQUEST]` and consumes the assistant's `BOOKING_RESULT_JSON:` response to render its own customer-facing result card, including returned alternatives for unavailable slots; raw JSON is not shown to form customers. The email includes the exact quote with a `$` prefix and a human-readable weekday/date/time.
