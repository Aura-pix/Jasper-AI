import {
  BUSINESS_TIMEZONE,
  TIME_SLOTS,
  type BookingRequest,
  type QuoteRequest,
} from "./booking";
import { MAX_DISTANCE_MILES, MIN_DISTANCE_MILES } from "./pricing";
import { isJobType, type JobType } from "./services";

export type FieldErrors = Record<string, string>;

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldErrors };

export type QuoteInput = QuoteRequest;
export type BookingInput = BookingRequest;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_SLOT_SET = new Set<string>(TIME_SLOTS);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function getTodayInNewYork(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validateQuoteInput(input: unknown): ValidationResult<QuoteInput> {
  const record = asRecord(input);

  if (!record) {
    return { ok: false, errors: { form: "Send a valid request." } };
  }

  const errors: FieldErrors = {};
  const jobType = record["Job Type"];
  const distance = record["Distance (miles)"];

  if (!isJobType(jobType)) {
    errors["Job Type"] = "Choose a job type.";
  }

  if (typeof distance !== "number" || !Number.isFinite(distance)) {
    errors["Distance (miles)"] = "Enter a distance between 1 and 50 miles.";
  } else if (distance < MIN_DISTANCE_MILES) {
    errors["Distance (miles)"] = "Enter a distance of at least 1 mile.";
  } else if (distance > MAX_DISTANCE_MILES) {
    errors["Distance (miles)"] = `Enter a distance of ${MAX_DISTANCE_MILES} miles or less.`;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      "Job Type": jobType as JobType,
      "Distance (miles)": distance as number,
    },
  };
}

export function validateBookingInput(
  input: unknown,
  today = getTodayInNewYork(),
): ValidationResult<BookingInput> {
  const record = asRecord(input);

  if (!record) {
    return { ok: false, errors: { form: "Send a valid request." } };
  }

  const quote = validateQuoteInput(record);
  const errors: FieldErrors = quote.ok ? {} : { ...quote.errors };

  const name = record.Name;

  if (typeof name !== "string" || name.trim().length < 2) {
    errors.Name = "Enter your name.";
  } else if (name.trim().length > 80) {
    errors.Name = "Enter a shorter name.";
  }

  const email = record.Email;

  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) {
    errors.Email = "Enter a valid email address.";
  }

  const date = record["Requested Date"];

  if (typeof date !== "string" || !isCalendarDate(date)) {
    errors["Requested Date"] = "Choose a requested date.";
  } else if (date < today) {
    errors["Requested Date"] = "Choose a date from today onward.";
  }

  const time = record["Requested Time"];

  if (typeof time !== "string" || !TIME_SLOT_SET.has(time)) {
    errors["Requested Time"] =
      "Choose a requested time between 8:00 AM and 6:00 PM.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      Name: (name as string).trim(),
      Email: (email as string).trim(),
      "Job Type": record["Job Type"] as JobType,
      "Distance (miles)": record["Distance (miles)"] as number,
      "Requested Date": date as string,
      "Requested Time": time as string,
    },
  };
}