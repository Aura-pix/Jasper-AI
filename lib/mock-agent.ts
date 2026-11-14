import {
  TIME_SLOTS,
  type AgentAction,
  type BookingRequest,
  type BookingResult,
  type BookingSlot,
} from "./booking";
import { calculateQuote } from "./pricing";

const MOCK_BOOKED_TIME = "12:00";

const CONFIRMED_ACTIONS: AgentAction[] = [
  { Step: "Calculating the price", Status: "Done" },
  { Step: "Saving the request", Status: "Done" },
  { Step: "Checking availability", Status: "Done" },
  { Step: "Confirming the booking", Status: "Done" },
  { Step: "Sending the confirmation email", Status: "Done" },
];

const UNAVAILABLE_ACTIONS: AgentAction[] = [
  { Step: "Calculating the price", Status: "Done" },
  { Step: "Saving the request", Status: "Done" },
  { Step: "Checking availability", Status: "Failed" },
  { Step: "Updating the booking status", Status: "Done" },
];

function dayOfWeek(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function isMockSlotAvailable(date: string, time: string): boolean {
  return (
    dayOfWeek(date) !== 0 &&
    TIME_SLOTS.includes(time) &&
    time !== MOCK_BOOKED_TIME
  );
}

export function getMockAlternatives(
  date: string,
  requestedTime: string,
  count = 3,
): BookingSlot[] {
  const alternatives: { date: string; time: string }[] = [];

  for (
    let dayOffset = 0;
    dayOffset < 14 && alternatives.length < count;
    dayOffset += 1
  ) {
    const cursor = dayOffset === 0 ? date : addDays(date, dayOffset);

    if (dayOfWeek(cursor) === 0) {
      continue;
    }

    const openSlots = TIME_SLOTS.filter(
      (time) => time !== requestedTime && time !== MOCK_BOOKED_TIME,
    );
    const ordered =
      dayOffset === 0
        ? [
            ...openSlots.filter((time) => time > requestedTime),
            ...openSlots.filter((time) => time < requestedTime),
          ]
        : openSlots;

    for (const time of ordered) {
      if (alternatives.length === count) {
        break;
      }

      alternatives.push({ date: cursor, time });
    }
  }

  return alternatives.map(({ date, time }) => ({
    "Requested Date": date,
    "Requested Time": time,
  }));
}

export function getMockBookingResult(request: BookingRequest): BookingResult {
  const date = request["Requested Date"];
  const time = request["Requested Time"];

  if (!isMockSlotAvailable(date, time)) {
    return {
      "Booking Status": "Unavailable",
      Message: "That time isn't available.",
      Alternatives: getMockAlternatives(date, time),
      Actions: UNAVAILABLE_ACTIONS,
    };
  }

  const quote = calculateQuote(
    request["Job Type"],
    request["Distance (miles)"],
  );

  return {
    "Booking Status": "Confirmed",
    "Price Quote": quote["Price Quote"],
    "Booking ID": `JPH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    Slot: {
      "Requested Date": date,
      "Requested Time": time,
    },
    Actions: CONFIRMED_ACTIONS,
  };
}