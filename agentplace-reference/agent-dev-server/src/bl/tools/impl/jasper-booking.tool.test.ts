import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ToolExecuteContext } from '../../agent/agent-library.ts';
import {
  JASPER_BOOKING_HEADERS,
  JASPER_BOOKING_SPREADSHEET_ID,
  JASPER_PRIMARY_CALENDAR_ID,
  JasperBookingWorkflowTool,
} from './jasper-booking.tool.ts';

type Operation =
  | 'getSheetNames'
  | 'getValues'
  | 'upsertRows'
  | 'calendarFreeBusy'
  | 'sendEmail';
type Call = { operation: Operation; args: Record<string, unknown> };

const REQUEST = {
  Name: 'Sample Customer',
  Email: 'customer@example.invalid',
  'Job Type': 'Leak or pipe repair',
  'Distance (miles)': 12,
  'Requested Date': '2026-11-20',
  'Requested Time': '14:00',
  Timezone: 'America/New_York',
} as const;

function makeContext(): ToolExecuteContext {
  return { runner: { state: undefined }, toolCallId: 'jasper-test' };
}

function setup(options: {
  busy?: Array<{ start: string; end: string }>;
  failOperation?: Operation;
  failUpsertAt?: number;
  quoteStatus?: number;
  bookingId?: string;
} = {}) {
  const calls: Call[] = [];
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return new Response('{"Price Quote":138.60}', {
      status: options.quoteStatus ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const invokeIntegration = async (
    operation: Operation,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    calls.push({ operation, args });
    if (options.failOperation === operation) throw new Error('mock failure');
    if (operation === 'upsertRows' && calls.filter((call) => call.operation === 'upsertRows').length === options.failUpsertAt) {
      throw new Error('mock sheet write failure');
    }
    switch (operation) {
      case 'getSheetNames':
        return { sheet_names: ['Sheet1'] };
      case 'getValues':
        return { values: [[...JASPER_BOOKING_HEADERS]] };
      case 'calendarFreeBusy':
        return { calendars: { [JASPER_PRIMARY_CALENDAR_ID]: { busy: options.busy ?? [] } } };
      case 'upsertRows':
        return { success: true };
      case 'sendEmail':
        return { success: true };
    }
  };
  const tool = new JasperBookingWorkflowTool({
    mcpTools: [],
    fetcher,
    now: () => new Date('2026-10-01T16:00:00.000Z'),
    createBookingId: () => options.bookingId ?? 'JPH-TEST',
    invokeIntegration,
  });
  return { tool, calls, fetchCalls };
}

function parseOutput(output: unknown): Record<string, unknown> {
  assert.equal(typeof output, 'string');
  return JSON.parse(String(output)) as Record<string, unknown>;
}

describe('JasperBookingWorkflowTool', () => {
  it('gets the exact quote, appends one pending row, checks availability, confirms the same row, and sends the exact email', async () => {
    const testBookingId = 'JPH-TEST-ABC123';
    const { tool, calls, fetchCalls } = setup({ bookingId: testBookingId });
    const rawResult = (await tool.execute(REQUEST, makeContext())).output;
    const result = parseOutput(rawResult);

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'https://example.invalid/api/quote');
    assert.equal(fetchCalls[0].init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(fetchCalls[0].init?.body)), {
      'Job Type': 'Leak or pipe repair',
      'Distance (miles)': 12,
    });

    assert.deepEqual(result, {
      'Booking Status': 'Confirmed',
      'Price Quote': 138.6,
      'Booking ID': testBookingId,
      'Booking Reference': 'ABC123',
      Slot: { 'Requested Date': '2026-11-20', 'Requested Time': '14:00' },
      Actions: [
        { Step: 'Calculating the price', Status: 'Done' },
        { Step: 'Saving the request', Status: 'Done' },
        { Step: 'Checking availability', Status: 'Done' },
        { Step: 'Confirming the booking', Status: 'Done' },
        { Step: 'Sending the confirmation email', Status: 'Done' },
      ],
    });
    assert.match(String(rawResult), /"Price Quote":\s*138\.60/);

    const sheetNamesCall = calls.find((call) => call.operation === 'getSheetNames');
    assert.deepEqual(sheetNamesCall?.args, {
      spreadsheet_id: JASPER_BOOKING_SPREADSHEET_ID,
      exclude_hidden: false,
    });
    const headerRead = calls.find((call) => call.operation === 'getValues');
    assert.equal(headerRead?.args.spreadsheet_id, JASPER_BOOKING_SPREADSHEET_ID);
    assert.equal(headerRead?.args.range, "'Sheet1'!A1:J1");

    const upserts = calls.filter((call) => call.operation === 'upsertRows');
    assert.equal(upserts.length, 2);
    assert.equal(upserts[0].args.spreadsheetId, JASPER_BOOKING_SPREADSHEET_ID);
    assert.deepEqual(upserts[0].args.headers, [...JASPER_BOOKING_HEADERS]);
    assert.deepEqual(upserts[0].args.rows, [[
      'Sample Customer',
      'customer@example.invalid',
      'Leak or pipe repair',
      12,
      138.6,
      'Pending Calendar Check',
      '2026-10-01T12:00:00-04:00',
      '2026-11-20',
      '14:00',
      testBookingId,
    ]]);
    assert.equal(upserts[1].args.spreadsheetId, JASPER_BOOKING_SPREADSHEET_ID);
    assert.deepEqual(upserts[1].args.headers, ['Booking ID', 'Booking Status']);
    assert.deepEqual(upserts[1].args.rows, [[testBookingId, 'Confirmed']]);

    const calendar = calls.find((call) => call.operation === 'calendarFreeBusy');
    assert.deepEqual(calendar?.args.items, [{ id: JASPER_PRIMARY_CALENDAR_ID }]);
    assert.equal(calendar?.args.timeZone, 'America/New_York');
    assert.equal(calendar?.args.timeMin, '2026-11-20T00:00:00-05:00');
    assert.equal(calendar?.args.timeMax, '2026-12-20T00:00:00-05:00');
    assert.equal(calls.some((call) => call.operation === 'sendEmail'), true);
    const email = calls.find((call) => call.operation === 'sendEmail');
    assert.deepEqual(email?.args, {
      recipient_email: 'customer@example.invalid',
      subject: 'Your Jasper Plumbing House booking confirmation',
      body: 'Thanks Sample Customer, your quote for Leak or pipe repair is $138.60. We have booked you for Friday, 20th November 2026 at 2pm.',
      is_html: false,
      include_signature: false,
    });
    assert.equal(calls.some((call) => String(call.operation).toLowerCase().includes('event')), false);
  });

  it('formats the quote and appointment date and time naturally in the confirmation email', async () => {
    const { tool, calls } = setup();
    const request = { ...REQUEST, 'Requested Date': '2026-11-16', 'Requested Time': '09:00' };
    await tool.execute(request, makeContext());

    const email = calls.find((call) => call.operation === 'sendEmail');
    assert.equal(
      email?.args.body,
      'Thanks Sample Customer, your quote for Leak or pipe repair is $138.60. We have booked you for Monday, 16th November 2026 at 9am.',
    );
  });

  it('marks an unavailable request and returns up to three future weekday alternatives without emailing', async () => {
    const { tool, calls } = setup({
      busy: [{ start: '2026-11-24T19:00:00Z', end: '2026-11-24T20:00:00Z' }],
    });
    const request = { ...REQUEST, 'Requested Date': '2026-11-24' };
    const result = parseOutput((await tool.execute(request, makeContext())).output);

    assert.deepEqual(result, {
      'Booking Status': 'Unavailable',
      Message: "That time isn't available.",
      Alternatives: [
        { 'Requested Date': '2026-11-24', 'Requested Time': '08:00' },
        { 'Requested Date': '2026-11-24', 'Requested Time': '09:00' },
        { 'Requested Date': '2026-11-24', 'Requested Time': '10:00' },
      ],
      Actions: [
        { Step: 'Calculating the price', Status: 'Done' },
        { Step: 'Saving the request', Status: 'Done' },
        { Step: 'Checking availability', Status: 'Failed' },
        { Step: 'Updating the booking status', Status: 'Done' },
      ],
    });
    const upserts = calls.filter((call) => call.operation === 'upsertRows');
    assert.equal(upserts.length, 2);
    assert.deepEqual(upserts[1].args.rows, [['JPH-TEST', 'Unavailable']]);
    assert.equal(calls.some((call) => call.operation === 'sendEmail'), false);
  });

  it('explicitly marks Sunday appointments unavailable without querying Calendar or emailing', async () => {
    const { tool, calls } = setup();
    const request = { ...REQUEST, 'Requested Date': '2026-11-22' };
    const result = parseOutput((await tool.execute(request, makeContext())).output);

    assert.deepEqual(result, {
      'Booking Status': 'Unavailable',
      Message: 'Sunday appointments are unavailable.',
      Alternatives: [],
      Actions: [
        { Step: 'Calculating the price', Status: 'Done' },
        { Step: 'Saving the request', Status: 'Done' },
        { Step: 'Applying Sunday closure', Status: 'Done' },
        { Step: 'Updating the booking status', Status: 'Done' },
      ],
    });
    assert.equal(calls.some((call) => call.operation === 'calendarFreeBusy'), false);
    assert.equal(calls.some((call) => call.operation === 'sendEmail'), false);
    const upserts = calls.filter((call) => call.operation === 'upsertRows');
    assert.deepEqual(upserts[1].args.rows, [['JPH-TEST', 'Unavailable']]);
  });

  it('rejects non-Sunday appointment starts outside the on-the-hour 08:00-17:00 window without side effects', async () => {
    for (const time of ['07:00', '08:30', '17:30', '18:00']) {
      const { tool, calls, fetchCalls } = setup();
      const result = parseOutput(
        (await tool.execute({ ...REQUEST, 'Requested Time': time }, makeContext())).output,
      );

      assert.equal(result['Booking Status'], 'Unavailable', time);
      assert.match(String(result.Message), /Monday through Saturday from 08:00 to 18:00 Eastern/);
      assert.deepEqual(result.Alternatives, []);
      assert.equal(calls.length, 0, time);
      assert.equal(fetchCalls.length, 0, time);
    }
  });

  it('accepts the final one-hour appointment start at 17:00', async () => {
    const { tool, calls, fetchCalls } = setup();
    const result = parseOutput(
      (await tool.execute({ ...REQUEST, 'Requested Time': '17:00' }, makeContext())).output,
    );

    assert.equal(result['Booking Status'], 'Confirmed');
    assert.deepEqual(result.Slot, { 'Requested Date': '2026-11-20', 'Requested Time': '17:00' });
    assert.equal(fetchCalls.length, 1);
    const email = calls.find((call) => call.operation === 'sendEmail');
    assert.match(String(email?.args.body), /Friday, 20th November 2026 at 5pm\./);
  });

  it('marks a calendar failure Failed and does not send email', async () => {
    const { tool, calls } = setup({ failOperation: 'calendarFreeBusy' });
    const rawResult = (await tool.execute(REQUEST, makeContext())).output;
    const result = parseOutput(rawResult);
    assert.equal(result['Booking Status'], 'Failed');
    assert.match(String(result.Message), /calendar availability/);
    assert.match(String(rawResult), /"Booking Status":\s*"Failed"/);
    assert.equal(calls.some((call) => call.operation === 'sendEmail'), false);
    const upserts = calls.filter((call) => call.operation === 'upsertRows');
    assert.equal(upserts[upserts.length - 1].args.rows?.toString(), 'JPH-TEST,Failed');
  });

  it('does not claim a failed pending write succeeded and tries the same Booking ID with Failed status', async () => {
    const { tool, calls } = setup({ failUpsertAt: 1 });
    const result = parseOutput((await tool.execute(REQUEST, makeContext())).output);
    assert.equal(result['Booking Status'], 'Failed');
    assert.match(String(result.Message), /marked Failed/);
    const upserts = calls.filter((call) => call.operation === 'upsertRows');
    assert.equal(upserts.length, 2);
    assert.deepEqual(upserts[1].args.headers, [...JASPER_BOOKING_HEADERS]);
    const failedRow = (upserts[1].args.rows as unknown[][])[0];
    assert.equal(failedRow[5], 'Failed');
    assert.equal(failedRow[9], 'JPH-TEST');
    assert.equal(calls.some((call) => call.operation === 'calendarFreeBusy'), false);
  });

  it('marks a Gmail failure Failed and does not retry the email', async () => {
    const { tool, calls } = setup({ failOperation: 'sendEmail' });
    const result = parseOutput((await tool.execute(REQUEST, makeContext())).output);
    assert.equal(result['Booking Status'], 'Failed');
    assert.match(String(result.Message), /marked Failed/);
    assert.equal(calls.filter((call) => call.operation === 'sendEmail').length, 1);
    const upserts = calls.filter((call) => call.operation === 'upsertRows');
    assert.deepEqual(upserts[2].args.rows, [['JPH-TEST', 'Failed']]);
  });

  it('returns formatted past-date failure JSON without calling external services', async () => {
    const { tool, calls, fetchCalls } = setup();
    const request = { ...REQUEST, 'Requested Date': '2000-01-01', 'Requested Time': '12:00' };
    const rawResult = String((await tool.execute(request, makeContext())).output);
    assert.match(rawResult, /\n  "Booking Status": "Failed"/);
    assert.equal(calls.length, 0);
    assert.equal(fetchCalls.length, 0);
  });

  it('rejects an ambiguous daylight-saving local time before calling any external service', async () => {
    const { tool, calls, fetchCalls } = setup();
    const request = { ...REQUEST, 'Requested Date': '2026-11-01', 'Requested Time': '01:30' };
    const result = parseOutput((await tool.execute(request, makeContext())).output);
    assert.equal(result['Booking Status'], 'Failed');
    assert.ok(String(result.Message).includes('invalid in America/New_York'));
    assert.equal(fetchCalls.length, 0);
    assert.equal(calls.length, 0);
  });

  it('rejects extra fields, invalid job types, and a non-New-York timezone in the input schema', () => {
    const schema = new JasperBookingWorkflowTool({ mcpTools: [], invokeIntegration: async () => ({}) }).parametersSchema;
    assert.ok('safeParse' in schema && typeof schema.safeParse === 'function');
    assert.equal(schema.safeParse(REQUEST).success, true);
    assert.equal(schema.safeParse({ ...REQUEST, Extra: 'unexpected' }).success, false);
    assert.equal(schema.safeParse({ ...REQUEST, 'Job Type': 'Plumbing' }).success, false);
    assert.equal(schema.safeParse({ ...REQUEST, Timezone: 'UTC' }).success, false);
  });
});
