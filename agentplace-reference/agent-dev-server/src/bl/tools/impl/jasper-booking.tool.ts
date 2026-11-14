import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ToolModel,
  type ToolExecuteContext,
  type ToolExecuteResult,
} from '../../agent/agent-library.ts';
import { MCPToolModel } from './mcp-tool-model.ts';

export const JASPER_BOOKING_TOOL_NAME = 'jasperBookingWorkflow';
export const JASPER_TIME_ZONE = 'America/New_York';
export const JASPER_PRIMARY_CALENDAR_ID = 'REPLACE_WITH_PRIMARY_CALENDAR_ID';
export const JASPER_BOOKING_SPREADSHEET_ID = 'REPLACE_WITH_SPREADSHEET_ID';
export const JASPER_BOOKING_HEADERS = [
  'Name',
  'Email',
  'Job Type',
  'Distance (miles)',
  'Price Quote',
  'Booking Status',
  'Timestamp',
  'Requested Date',
  'Requested Time',
  'Booking ID',
] as const;

const JOB_TYPES = [
  'Emergency repair',
  'Water heater service',
  'Leak or pipe repair',
  'General plumbing',
  'Fixture installation',
  'Drain cleaning',
] as const;

const bookingSchema = z
  .object({
    Name: z.string().min(1).max(200).describe('Customer name, exactly as provided.'),
    Email: z
      .string()
      .min(3)
      .max(320)
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
      .describe('Customer email address.'),
    'Job Type': z.enum(JOB_TYPES).describe('One of the six exact supported plumbing job types.'),
    'Distance (miles)': z.number().finite().min(0).describe('Customer distance in miles.'),
    'Requested Date': z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Local date, YYYY-MM-DD.'),
    'Requested Time': z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).describe('Local 24-hour time, HH:mm.'),
    Timezone: z.literal(JASPER_TIME_ZONE),
  })
  .strict();

type BookingInput = z.infer<typeof bookingSchema>;
type IntegrationOperation =
  | 'getSheetNames'
  | 'getValues'
  | 'upsertRows'
  | 'calendarFreeBusy'
  | 'sendEmail';
type BookingStatus = 'Pending Calendar Check' | 'Confirmed' | 'Unavailable' | 'Failed';
type IntegrationInvoker = (
  operation: IntegrationOperation,
  args: Record<string, unknown>,
  ctx: ToolExecuteContext,
) => Promise<unknown>;

type SpreadsheetTarget = { spreadsheetId: string; sheetName: string };
type BusyInterval = { start: number; end: number };
type Action = { Step: string; Status: 'Done' | 'Failed' };

type Dependencies = {
  mcpTools: readonly MCPToolModel[];
  fetcher?: typeof fetch;
  now?: () => Date;
  createBookingId?: () => string;
  invokeIntegration?: IntegrationInvoker;
};

const GET_SHEET_NAMES = 'GOOGLESHEETS_GET_SHEET_NAMES';
const GET_VALUES = 'GOOGLESHEETS_VALUES_GET';
const UPSERT_ROWS = 'GOOGLESHEETS_UPSERT_ROWS';
const CALENDAR_FREE_BUSY = 'GOOGLECALENDAR_FREE_BUSY_QUERY';
const SEND_EMAIL = 'GMAIL_SEND_EMAIL';
const QUOTE_URL = 'https://example.invalid/api/quote';
const ALTERNATIVE_HORIZON_DAYS = 30;
const SLOT_DURATION_MS = 60 * 60 * 1000;
const FIRST_APPOINTMENT_HOUR = 8;
const LAST_APPOINTMENT_START_HOUR = 17;

const REQUIRED_TOOL_PROPERTIES: Record<IntegrationOperation, { name: string; properties: string[] }> = {
  getSheetNames: { name: GET_SHEET_NAMES, properties: ['spreadsheet_id'] },
  getValues: { name: GET_VALUES, properties: ['spreadsheet_id', 'range'] },
  upsertRows: {
    name: UPSERT_ROWS,
    properties: ['spreadsheetId', 'sheetName', 'rows', 'headers', 'keyColumn'],
  },
  calendarFreeBusy: {
    name: CALENDAR_FREE_BUSY,
    properties: ['items', 'timeMin', 'timeMax', 'timeZone'],
  },
  sendEmail: {
    name: SEND_EMAIL,
    properties: ['recipient_email', 'subject', 'body', 'include_signature'],
  },
};

const FAILURE_ACTION: Action[] = [{ Step: 'Working on your booking', Status: 'Failed' }];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaHasProperties(tool: MCPToolModel, names: readonly string[]): boolean {
  const schema = tool.getParameters();
  const properties = isObject(schema) && isObject(schema.properties) ? schema.properties : null;
  return properties !== null && names.every((name) => name in properties);
}

function resolveMcpTools(tools: readonly MCPToolModel[]): Map<IntegrationOperation, MCPToolModel> {
  const resolved = new Map<IntegrationOperation, MCPToolModel>();
  for (const [operation, expected] of Object.entries(REQUIRED_TOOL_PROPERTIES) as Array<
    [IntegrationOperation, (typeof REQUIRED_TOOL_PROPERTIES)[IntegrationOperation]]
  >) {
    const named = tools.find(
      (tool) => tool.getName() === expected.name && schemaHasProperties(tool, expected.properties),
    );
    if (named) {
      resolved.set(operation, named);
      continue;
    }
    const candidates = tools.filter((tool) => schemaHasProperties(tool, expected.properties));
    if (candidates.length === 1) {
      resolved.set(operation, candidates[0]);
    }
  }
  return resolved;
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Empty integration response');
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const unwrapped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(unwrapped) as unknown;
    } catch {
      return text;
    }
  }
}

function containsProviderError(value: unknown): boolean {
  if (typeof value === 'string') return /^\s*(?:error|failed)\b/i.test(value);
  if (Array.isArray(value)) return value.some(containsProviderError);
  if (!isObject(value)) return false;
  if (value.isError === true || value.success === false || value.ok === false) return true;
  if (typeof value.error === 'string' && value.error.trim()) return true;
  if (isObject(value.error) && Object.keys(value.error).length > 0) return true;
  return Object.values(value).some(containsProviderError);
}

function getNamedValue(value: unknown, names: readonly string[]): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = getNamedValue(item, names);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isObject(value)) return undefined;
  for (const name of names) {
    if (Object.hasOwn(value, name)) return value[name];
  }
  for (const nested of Object.values(value)) {
    const found = getNamedValue(nested, names);
    if (found !== undefined) return found;
  }
  return undefined;
}

function collectSheetNames(value: unknown, names: string[] = [], parentKey = ''): string[] {
  if (Array.isArray(value)) {
    if (/sheet|tab|name/i.test(parentKey)) {
      for (const item of value) {
        if (typeof item === 'string') names.push(item);
        else if (isObject(item)) {
          const candidate = item.title ?? item.name ?? item.sheetName;
          if (typeof candidate === 'string') names.push(candidate);
        }
      }
    }
    for (const item of value) collectSheetNames(item, names, parentKey);
    return names;
  }
  if (!isObject(value)) return names;
  if (Array.isArray(value.sheets)) {
    for (const sheet of value.sheets) {
      if (isObject(sheet) && isObject(sheet.properties) && typeof sheet.properties.title === 'string') {
        names.push(sheet.properties.title);
      }
    }
  }
  for (const [key, nested] of Object.entries(value)) {
    if (/sheet|tab|name/i.test(key) && typeof nested === 'string') names.push(nested);
    collectSheetNames(nested, names, key);
  }
  return names;
}

function findValuesGrid(value: unknown): unknown[][] | null {
  if (Array.isArray(value)) {
    if (value.every((row) => Array.isArray(row))) return value as unknown[][];
    for (const item of value) {
      const found = findValuesGrid(item);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;
  if (Array.isArray(value.values) && value.values.every((row) => Array.isArray(row))) {
    return value.values as unknown[][];
  }
  for (const nested of Object.values(value)) {
    const found = findValuesGrid(nested);
    if (found) return found;
  }
  return null;
}

function zonedParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const values = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((out, part) => {
      if (part.type !== 'literal') out[part.type] = part.value;
      return out;
    }, {});
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function offsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function formatZonedIso(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  const localAtSecond = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offset = Math.round((localAtSecond - date.getTime()) / 60_000);
  const milliseconds = date.getUTCMilliseconds();
  const fraction = milliseconds === 0 ? '' : `.${String(milliseconds).padStart(3, '0')}`;
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}${fraction}${offsetLabel(offset)}`;
}

function localDateTimeToEpoch(dateText: string, timeText: string, timeZone: string): number {
  const [year, month, day] = dateText.split('-').map(Number);
  const [hour, minute] = timeText.split(':').map(Number);
  const targetWallTime = Date.UTC(year, month - 1, day, hour, minute, 0);
  const targetDate = new Date(targetWallTime);
  if (
    targetDate.getUTCFullYear() !== year ||
    targetDate.getUTCMonth() + 1 !== month ||
    targetDate.getUTCDate() !== day
  ) {
    throw new Error('Invalid local calendar date');
  }

  let guess = targetWallTime;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const observed = zonedParts(new Date(guess), timeZone);
    const observedWallTime = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const adjustment = targetWallTime - observedWallTime;
    if (adjustment === 0) break;
    guess += adjustment;
  }
  const check = zonedParts(new Date(guess), timeZone);
  if (
    check.year !== year ||
    check.month !== month ||
    check.day !== day ||
    check.hour !== hour ||
    check.minute !== minute
  ) {
    throw new Error('Requested local time does not exist in the specified timezone');
  }
  const isSameLocalMinute = (candidate: number) => {
    const local = zonedParts(new Date(candidate), timeZone);
    return (
      local.year === year &&
      local.month === month &&
      local.day === day &&
      local.hour === hour &&
      local.minute === minute
    );
  };
  if (isSameLocalMinute(guess - SLOT_DURATION_MS) || isSameLocalMinute(guess + SLOT_DURATION_MS)) {
    throw new Error('Requested local time is ambiguous during the daylight-saving change');
  }
  return guess;
}

function addCalendarDays(dateText: string, count: number): string {
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + count));
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function dayOfWeek(dateText: string): number {
  const [year, month, day] = dateText.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isWithinAppointmentWindow(timeText: string): boolean {
  const [hour, minute] = timeText.split(':').map(Number);
  return minute === 0 && hour >= FIRST_APPOINTMENT_HOUR && hour <= LAST_APPOINTMENT_START_HOUR;
}

function ordinalDay(day: number): string {
  const remainder = day % 100;
  const suffix = remainder >= 11 && remainder <= 13
    ? 'th'
    : day % 10 === 1
      ? 'st'
      : day % 10 === 2
        ? 'nd'
        : day % 10 === 3
          ? 'rd'
          : 'th';
  return `${day}${suffix}`;
}

function formatCustomerAppointment(dateText: string, timeText: string): string {
  const [year, month, day] = dateText.split('-').map(Number);
  const localDate = new Date(Date.UTC(year, month - 1, day));
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(localDate);
  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(localDate);
  const [hour, minute] = timeText.split(':').map(Number);
  const twelveHour = hour % 12 || 12;
  const meridiem = hour < 12 ? 'am' : 'pm';
  const time = minute === 0
    ? `${twelveHour}${meridiem}`
    : `${twelveHour}:${String(minute).padStart(2, '0')}${meridiem}`;
  return `${weekday}, ${ordinalDay(day)} ${monthName} ${year} at ${time}`;
}

function quoteResult(raw: string): { value: number; lexicalNumber: string } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Pricing service returned an unreadable response');
  }
  if (!isObject(decoded)) throw new Error('Pricing service returned an invalid response');
  const value = decoded['Price Quote'];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Pricing service did not return a finite numeric quote');
  }
  const match = raw.match(/"Price Quote"\s*:\s*(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
  const lexicalNumber = match && Number(match[1]) === value ? match[1] : String(value);
  return { value, lexicalNumber };
}

function serializeResult(payload: Record<string, unknown>, priceLexeme?: string): string {
  const json = JSON.stringify(payload, null, 2);
  if (!priceLexeme) return json;
  return json.replace(/("Price Quote"\s*:\s*)(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/, `$1${priceLexeme}`);
}

function failed(message: string): ToolExecuteResult {
  return {
    output: JSON.stringify(
      {
        'Booking Status': 'Failed',
        Message: message,
        Actions: FAILURE_ACTION,
      },
      null,
      2,
    ),
  };
}

function unavailableOutsideAppointmentWindow(): ToolExecuteResult {
  return {
    output: JSON.stringify(
      {
        'Booking Status': 'Unavailable',
        Message:
          'Appointments are offered Monday through Saturday from 08:00 to 18:00 Eastern, with one-hour starts on the hour from 08:00 through 17:00. No booking was processed.',
        Alternatives: [],
        Actions: [{ Step: 'Applying appointment-hours policy', Status: 'Done' }],
      },
      null,
      2,
    ),
  };
}

function assertNoProviderError(value: unknown): void {
  if (containsProviderError(value)) throw new Error('Integration returned an error result');
}

export class JasperBookingWorkflowTool extends ToolModel<BookingInput> {
  #tools: Map<IntegrationOperation, MCPToolModel>;
  #fetcher: typeof fetch;
  #now: () => Date;
  #createBookingId: () => string;
  #invokeOverride?: IntegrationInvoker;

  constructor(dependencies: Dependencies) {
    super({
      name: JASPER_BOOKING_TOOL_NAME,
      description:
        'Complete one Jasper Plumbing House booking in a single coordinated workflow. Accept the exact seven required fields. For a non-Sunday time outside the appointment window (one-hour starts on the hour from 08:00 through 17:00 Eastern), return Unavailable without making any external calls or saving a booking. For Sunday, mark it Unavailable by business policy without querying Calendar or sending email. For an in-hours weekday or Saturday request, get the authoritative quote, verify the owner-supplied Jasper Plumbing House spreadsheet ID and its header row, save one Pending Calendar Check row, check the requested 60-minute slot using the actual primary calendar ID, update that same row by Booking ID, and send the exact confirmation email only when available. Never create a Calendar event or call the underlying customer-booking integration tools separately. Return the exact structured JSON result for the orchestrator; it is internal data, not customer-facing output.',
      parametersSchema: bookingSchema,
      toolType: 'function',
      activityKind: 'service',
      isStreaming: false,
      isStrict: true,
    });
    this.#tools = resolveMcpTools(dependencies.mcpTools);
    this.#fetcher = dependencies.fetcher ?? fetch;
    this.#now = dependencies.now ?? (() => new Date());
    this.#createBookingId = dependencies.createBookingId ?? (() => `JPH-${randomUUID().toUpperCase()}`);
    this.#invokeOverride = dependencies.invokeIntegration;
  }

  async execute(input: BookingInput, ctx: ToolExecuteContext): Promise<ToolExecuteResult> {
    const parsed = bookingSchema.safeParse(input);
    if (!parsed.success) {
      return failed('Please provide all required booking details in the specified format.');
    }
    const booking = parsed.data;

    let requestedStart: number;
    try {
      requestedStart = localDateTimeToEpoch(
        booking['Requested Date'],
        booking['Requested Time'],
        booking.Timezone,
      );
      if (requestedStart < this.#now().getTime()) {
        return failed('The requested date and time must be in the future. No booking was processed.');
      }
    } catch {
      return failed('The requested date or time is invalid in America/New_York. No booking was processed.');
    }

    if (
      dayOfWeek(booking['Requested Date']) !== 0 &&
      !isWithinAppointmentWindow(booking['Requested Time'])
    ) {
      return unavailableOutsideAppointmentWindow();
    }

    const bookingId = this.#createBookingId();
    const missing = this.#missingOperations();
    if (missing.length > 0) {
      return failed('The booking workflow is not fully available, so we could not process this request.');
    }

    let quote: { value: number; lexicalNumber: string };
    try {
      quote = await this.#getQuote(booking);
    } catch {
      return failed('We could not get a verified price quote, so the booking was not processed.');
    }

    let sheet: SpreadsheetTarget;
    try {
      sheet = await this.#resolveBookingSheet(ctx);
    } catch {
      return failed('We could not verify the Jasper Plumbing House booking sheet, so no booking was saved.');
    }

    let pendingWriteAttempted = false;
    let pendingRow: unknown[] = [];
    try {
      const timestamp = formatZonedIso(this.#now(), JASPER_TIME_ZONE);
      pendingRow = [
        booking.Name,
        booking.Email,
        booking['Job Type'],
        booking['Distance (miles)'],
        quote.value,
        'Pending Calendar Check',
        timestamp,
        booking['Requested Date'],
        booking['Requested Time'],
        bookingId,
      ];
      pendingWriteAttempted = true;
      await this.#upsertRow(ctx, sheet, JASPER_BOOKING_HEADERS, [pendingRow]);
    } catch {
      let markedFailed = false;
      if (pendingWriteAttempted) {
        const failedRow = [...pendingRow];
        failedRow[5] = 'Failed';
        try {
          await this.#upsertRow(ctx, sheet, JASPER_BOOKING_HEADERS, [failedRow]);
          markedFailed = true;
        } catch {
          markedFailed = false;
        }
      }
      return failed(
        markedFailed
          ? 'We could not save the request as pending; the booking record was marked Failed.'
          : 'We could not save or verify the booking record. No confirmed booking was made.',
      );
    }

    if (dayOfWeek(booking['Requested Date']) === 0) {
      try {
        await this.#updateStatus(ctx, sheet, bookingId, 'Unavailable');
      } catch {
        const markedFailed = await this.#tryStatus(ctx, sheet, bookingId, 'Failed');
        return failed(
          markedFailed
            ? 'Sunday appointments are unavailable; the booking record was marked Failed after its status update failed.'
            : 'Sunday appointments are unavailable, but we could not verify the booking-record status.',
        );
      }
      return {
        output: JSON.stringify(
          {
            'Booking Status': 'Unavailable',
            Message: 'Sunday appointments are unavailable.',
            Alternatives: [],
            Actions: [
              { Step: 'Calculating the price', Status: 'Done' },
              { Step: 'Saving the request', Status: 'Done' },
              { Step: 'Applying Sunday closure', Status: 'Done' },
              { Step: 'Updating the booking status', Status: 'Done' },
            ],
          },
          null,
          2,
        ),
      };
    }

    let busy: BusyInterval[];
    try {
      busy = await this.#getBusyIntervals(ctx, booking);
    } catch {
      const markedFailed = await this.#tryStatus(ctx, sheet, bookingId, 'Failed');
      return failed(
        markedFailed
          ? 'We could not verify calendar availability; the booking record was marked Failed.'
          : 'We could not verify calendar availability or the final booking-record status. Please check the request before submitting it again.',
      );
    }

    const requestedEnd = requestedStart + SLOT_DURATION_MS;
    if (this.#isBusy(busy, requestedStart, requestedEnd)) {
      try {
        await this.#updateStatus(ctx, sheet, bookingId, 'Unavailable');
      } catch {
        const markedFailed = await this.#tryStatus(ctx, sheet, bookingId, 'Failed');
        return failed(
          markedFailed
            ? 'We could not save the availability result; the booking record was marked Failed.'
            : 'We could not verify the booking-record status. Please check the request before submitting it again.',
        );
      }
      const alternatives = this.#findAlternatives(
        busy,
        booking['Requested Date'],
        booking['Requested Date'],
        booking['Requested Time'],
      );
      return {
        output: JSON.stringify(
          {
            'Booking Status': 'Unavailable',
            Message: "That time isn't available.",
            Alternatives: alternatives,
            Actions: [
              { Step: 'Calculating the price', Status: 'Done' },
              { Step: 'Saving the request', Status: 'Done' },
              { Step: 'Checking availability', Status: 'Failed' },
              { Step: 'Updating the booking status', Status: 'Done' },
            ],
          },
          null,
          2,
        ),
      };
    }

    try {
      await this.#updateStatus(ctx, sheet, bookingId, 'Confirmed');
    } catch {
      const markedFailed = await this.#tryStatus(ctx, sheet, bookingId, 'Failed');
      return failed(
        markedFailed
          ? 'We could not verify the confirmation update; the booking record was marked Failed.'
          : 'We could not verify the booking-record status. Please check the request before submitting it again.',
      );
    }

    const emailBody = `Thanks ${booking.Name}, your quote for ${booking['Job Type']} is $${quote.lexicalNumber}. We have booked you for ${formatCustomerAppointment(booking['Requested Date'], booking['Requested Time'])}.`;
    try {
      const emailResult = await this.#invoke('sendEmail', {
        recipient_email: booking.Email,
        subject: 'Your Jasper Plumbing House booking confirmation',
        body: emailBody,
        is_html: false,
        include_signature: false,
      }, ctx);
      assertNoProviderError(emailResult);
    } catch {
      const markedFailed = await this.#tryStatus(ctx, sheet, bookingId, 'Failed');
      return failed(
        markedFailed
          ? 'The email service did not confirm delivery; the booking record was marked Failed.'
          : 'We could not confirm email delivery or verify the booking-record status. Please check the request before submitting it again.',
      );
    }

    const payload = {
      'Booking Status': 'Confirmed',
      'Price Quote': quote.value,
      'Booking ID': bookingId,
      'Booking Reference': bookingId.slice(-6),
      Slot: {
        'Requested Date': booking['Requested Date'],
        'Requested Time': booking['Requested Time'],
      },
      Actions: [
        { Step: 'Calculating the price', Status: 'Done' },
        { Step: 'Saving the request', Status: 'Done' },
        { Step: 'Checking availability', Status: 'Done' },
        { Step: 'Confirming the booking', Status: 'Done' },
        { Step: 'Sending the confirmation email', Status: 'Done' },
      ],
    };
    return { output: serializeResult(payload, quote.lexicalNumber) };
  }

  #missingOperations(): IntegrationOperation[] {
    if (this.#invokeOverride) return [];
    const operations = Object.keys(REQUIRED_TOOL_PROPERTIES) as IntegrationOperation[];
    return operations.filter((operation) => !this.#tools.has(operation));
  }

  async #invoke(
    operation: IntegrationOperation,
    args: Record<string, unknown>,
    ctx: ToolExecuteContext,
  ): Promise<unknown> {
    const result = this.#invokeOverride
      ? await this.#invokeOverride(operation, args, ctx)
      : await this.#executeMcp(operation, args, ctx);
    assertNoProviderError(result);
    return result;
  }

  async #executeMcp(
    operation: IntegrationOperation,
    args: Record<string, unknown>,
    _ctx: ToolExecuteContext,
  ): Promise<unknown> {
    const tool = this.#tools.get(operation);
    if (!tool) throw new Error('Required integration is unavailable');
    const result = await tool.executeRedacted(args);
    if (typeof result.output !== 'string') throw new Error('Integration returned no result');
    return parseJsonText(result.output);
  }

  async #getQuote(booking: BookingInput): Promise<{ value: number; lexicalNumber: string }> {
    const body = JSON.stringify({
      'Job Type': booking['Job Type'],
      'Distance (miles)': booking['Distance (miles)'],
    });
    const response = await this.#fetcher(QUOTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error('Pricing service did not accept the quote request');
    return quoteResult(raw);
  }

  async #resolveBookingSheet(ctx: ToolExecuteContext): Promise<SpreadsheetTarget> {
    const spreadsheetId = JASPER_BOOKING_SPREADSHEET_ID;
    const namesResult = await this.#invoke(
      'getSheetNames',
      { spreadsheet_id: spreadsheetId, exclude_hidden: false },
      ctx,
    );
    const sheetNames = [...new Set(collectSheetNames(namesResult).filter((name) => name.length > 0))];
    if (sheetNames.length === 0) throw new Error('Spreadsheet returned no worksheet names');

    const headerMatches: string[] = [];
    for (const sheetName of sheetNames) {
      const range = `'${sheetName.replaceAll("'", "''")}'!A1:J1`;
      const values = await this.#invoke(
        'getValues',
        {
          spreadsheet_id: spreadsheetId,
          range,
          major_dimension: 'ROWS',
          value_render_option: 'FORMATTED_VALUE',
        },
        ctx,
      );
      const grid = findValuesGrid(values);
      if (!grid || !Array.isArray(grid[0])) continue;
      const row = grid[0].slice(0, JASPER_BOOKING_HEADERS.length);
      if (
        row.length === JASPER_BOOKING_HEADERS.length &&
        row.every((cell, index) => cell === JASPER_BOOKING_HEADERS[index])
      ) {
        headerMatches.push(sheetName);
      }
    }
    if (headerMatches.length !== 1) throw new Error('Booking-sheet header row is missing or ambiguous');
    return { spreadsheetId, sheetName: headerMatches[0] };
  }

  async #upsertRow(
    ctx: ToolExecuteContext,
    sheet: SpreadsheetTarget,
    headers: readonly string[],
    rows: unknown[][],
  ): Promise<void> {
    const result = await this.#invoke(
      'upsertRows',
      {
        spreadsheetId: sheet.spreadsheetId,
        sheetName: sheet.sheetName,
        rows,
        headers: [...headers],
        keyColumn: 'Booking ID',
        strictMode: true,
        tableStart: 'A1',
      },
      ctx,
    );
    assertNoProviderError(result);
  }

  async #updateStatus(
    ctx: ToolExecuteContext,
    sheet: SpreadsheetTarget,
    bookingId: string,
    status: BookingStatus,
  ): Promise<void> {
    await this.#upsertRow(ctx, sheet, ['Booking ID', 'Booking Status'], [[bookingId, status]]);
  }

  async #tryStatus(
    ctx: ToolExecuteContext,
    sheet: SpreadsheetTarget,
    bookingId: string,
    status: BookingStatus,
  ): Promise<boolean> {
    try {
      await this.#updateStatus(ctx, sheet, bookingId, status);
      return true;
    } catch {
      return false;
    }
  }

  async #getBusyIntervals(ctx: ToolExecuteContext, booking: BookingInput): Promise<BusyInterval[]> {
    const fromDate = booking['Requested Date'];
    const throughDate = addCalendarDays(fromDate, ALTERNATIVE_HORIZON_DAYS);
    const start = localDateTimeToEpoch(fromDate, '00:00', JASPER_TIME_ZONE);
    const end = localDateTimeToEpoch(throughDate, '00:00', JASPER_TIME_ZONE);
    const result = await this.#invoke(
      'calendarFreeBusy',
      {
        items: [{ id: JASPER_PRIMARY_CALENDAR_ID }],
        timeMin: formatZonedIso(new Date(start), JASPER_TIME_ZONE),
        timeMax: formatZonedIso(new Date(end), JASPER_TIME_ZONE),
        timeZone: JASPER_TIME_ZONE,
      },
      ctx,
    );
    const calendars = getNamedValue(result, ['calendars']);
    if (!isObject(calendars) || !isObject(calendars[JASPER_PRIMARY_CALENDAR_ID])) {
      throw new Error('Calendar availability response did not include the primary calendar');
    }
    const primary = calendars[JASPER_PRIMARY_CALENDAR_ID];
    if (Array.isArray(primary.errors) && primary.errors.length > 0) {
      throw new Error('Calendar availability query returned a calendar error');
    }
    if (!Array.isArray(primary.busy)) throw new Error('Calendar response did not include busy intervals');
    const busy: BusyInterval[] = [];
    for (const interval of primary.busy) {
      if (!isObject(interval) || typeof interval.start !== 'string' || typeof interval.end !== 'string') {
        throw new Error('Calendar response contained a malformed busy interval');
      }
      const startAt = Date.parse(interval.start);
      const endAt = Date.parse(interval.end);
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
        throw new Error('Calendar response contained an invalid busy interval');
      }
      busy.push({ start: startAt, end: endAt });
    }
    return busy;
  }

  #isBusy(busy: readonly BusyInterval[], start: number, end: number): boolean {
    return busy.some((interval) => interval.start < end && interval.end > start);
  }

  #findAlternatives(
    busy: readonly BusyInterval[],
    requestedDate: string,
    requestedSlotDate: string,
    requestedTime: string,
  ): Array<{ 'Requested Date': string; 'Requested Time': string }> {
    const alternatives: Array<{ 'Requested Date': string; 'Requested Time': string }> = [];
    const now = this.#now().getTime();
    for (let day = 0; day < ALTERNATIVE_HORIZON_DAYS && alternatives.length < 3; day += 1) {
      const date = addCalendarDays(requestedDate, day);
      if (dayOfWeek(date) === 0) continue;
      for (let hour = 8; hour < 18 && alternatives.length < 3; hour += 1) {
        const time = `${String(hour).padStart(2, '0')}:00`;
        if (date === requestedSlotDate && time === requestedTime) continue;
        const start = localDateTimeToEpoch(date, time, JASPER_TIME_ZONE);
        const end = start + SLOT_DURATION_MS;
        if (start <= now || this.#isBusy(busy, start, end)) continue;
        alternatives.push({ 'Requested Date': date, 'Requested Time': time });
      }
    }
    return alternatives;
  }
}

export function createJasperBookingWorkflowTool(
  mcpTools: readonly MCPToolModel[],
): JasperBookingWorkflowTool {
  return new JasperBookingWorkflowTool({ mcpTools });
}
