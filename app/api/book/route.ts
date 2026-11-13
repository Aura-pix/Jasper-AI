import {
  BUSINESS_TIMEZONE,
  type ActionStatus,
  type AgentAction,
  type BookingRequest,
  type BookingResult,
  type BookingSlot,
} from "@/lib/booking";
import { getMockBookingResult } from "@/lib/mock-agent";
import { validateBookingInput } from "@/lib/validation";

export const maxDuration = 60;

const encoder = new TextEncoder();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeActionStatus(value: string): ActionStatus | null {
  const status = value.trim().toLowerCase();

  if (status === "active") {
    return "Active";
  }

  if (status === "done") {
    return "Done";
  }

  if (status === "failed") {
    return "Failed";
  }

  return null;
}

function normalizeActions(value: unknown): AgentAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }

    const record = item as Record<string, unknown>;
    const step =
      typeof record.Step === "string"
        ? record.Step
        : typeof record.step === "string"
          ? record.step
          : "";
    const rawStatus =
      typeof record.Status === "string"
        ? record.Status
        : typeof record.status === "string"
          ? record.status
          : "";
    const status = normalizeActionStatus(rawStatus);

    if (!step || !status) {
      return [];
    }

    return [{ Step: step, Status: status }];
  });
}

function parseSlot(value: unknown): BookingSlot | null {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const date =
      typeof record["Requested Date"] === "string"
        ? record["Requested Date"]
        : typeof record.date === "string"
          ? record.date
          : null;
    const time =
      typeof record["Requested Time"] === "string"
        ? record["Requested Time"]
        : typeof record.time === "string"
          ? record.time
          : null;

    if (date && time) {
      return { "Requested Date": date, "Requested Time": time };
    }
  }

  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value);

    if (match) {
      return { "Requested Date": match[1], "Requested Time": match[2] };
    }
  }

  return null;
}

function normalizeAgentResult(
  value: unknown,
  booking: BookingRequest,
): BookingResult {
  if (typeof value !== "object" || value === null) {
    return {
      "Booking Status": "Failed",
      Message: "The booking service returned an invalid response.",
      Actions: [{ Step: "Working on your booking", Status: "Failed" }],
    };
  }

  const record = value as Record<string, unknown>;
  const rawStatus = record["Booking Status"] ?? record.status;
  const status = typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : "";
  const actions = normalizeActions(record.Actions ?? record.actions);

  if (status === "confirmed") {
    const rawPrice = record["Price Quote"] ?? record.price;
    const price = typeof rawPrice === "number" ? rawPrice : Number(rawPrice);
    const slot = parseSlot(record.Slot ?? record.slot) ?? {
      "Requested Date": booking["Requested Date"],
      "Requested Time": booking["Requested Time"],
    };

    if (Number.isFinite(price)) {
      return {
        "Booking Status": "Confirmed",
        "Price Quote": price,
        "Booking ID":
          typeof (record["Booking ID"] ?? record.bookingId) === "string"
            ? ((record["Booking ID"] ?? record.bookingId) as string)
            : `JPH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        Slot: slot,
        Actions: actions,
      };
    }
  }

  if (status === "unavailable") {
    const rawAlternatives = record.Alternatives ?? record.alternatives;
    const alternatives = Array.isArray(rawAlternatives)
      ? rawAlternatives
          .map(parseSlot)
          .filter((slot): slot is BookingSlot => slot !== null)
      : [];

    return {
      "Booking Status": "Unavailable",
      Message:
        typeof (record.Message ?? record.message) === "string"
          ? ((record.Message ?? record.message) as string)
          : "That time isn't available.",
      Alternatives: alternatives,
      Actions: actions,
    };
  }

  return {
    "Booking Status": "Failed",
    Message:
      typeof (record.Message ?? record.message) === "string"
        ? ((record.Message ?? record.message) as string)
        : "We couldn't confirm this booking.",
    Actions: actions.length
      ? actions
      : [{ Step: "Working on your booking", Status: "Failed" }],
  };
}

async function callLiveAgent(booking: BookingRequest): Promise<BookingResult> {
  const url = process.env.AGENT_BOOKING_URL;

  if (!url) {
    return {
      "Booking Status": "Failed",
      Message: "The booking service is not configured.",
      Actions: [{ Step: "Working on your booking", Status: "Failed" }],
    };
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (process.env.AGENT_API_KEY) {
      headers.Authorization = `Bearer ${process.env.AGENT_API_KEY}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...booking,
        Timezone: BUSINESS_TIMEZONE,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return {
        "Booking Status": "Failed",
        Message: "We couldn't reach the booking service.",
        Actions: [{ Step: "Working on your booking", Status: "Failed" }],
      };
    }

    return normalizeAgentResult(await response.json(), booking);
  } catch {
    return {
      "Booking Status": "Failed",
      Message: "The booking service did not respond in time.",
      Actions: [{ Step: "Working on your booking", Status: "Failed" }],
    };
  }
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a valid JSON body." }, { status: 400 });
  }

  const validation = validateBookingInput(body);

  if (!validation.ok) {
    return Response.json(
      { error: "Check the booking details.", fields: validation.errors },
      { status: 400 },
    );
  }

  const booking = validation.data;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let finished = false;

      const send = (event: string, data: unknown) => {
        if (finished) {
          return;
        }

        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          finished = true;
        }
      };

      const finish = () => {
        if (finished) {
          return;
        }

        finished = true;

        try {
          controller.close();
        } catch {
          // The client disconnected before the stream closed.
        }
      };

      try {
        if (process.env.AGENT_MODE === "live") {
          const result = await callLiveAgent(booking);
          send("result", result);
          finish();
          return;
        }

        const result = getMockBookingResult(booking);

        for (const action of result.Actions) {
          send("action", { Step: action.Step, Status: "Active" });
          await sleep(450);
          send("action", action);
          await sleep(120);
        }

        send("result", result);
        finish();
      } catch {
        send("result", {
          "Booking Status": "Failed",
          Message: "We couldn't confirm this booking.",
          Actions: [{ Step: "Working on your booking", Status: "Failed" }],
        } satisfies BookingResult);
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}