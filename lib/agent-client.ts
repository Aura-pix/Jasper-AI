import type { BookingRequest } from "./booking";

export const AGENT_RESULT_MARKER = "BOOKING_RESULT_JSON:";
const AGENT_REQUEST_TIMEOUT_MS = 20_000;
const AGENT_WS_TIMEOUT_MS = 35_000;
const CONTENT_POLL_INTERVAL_MS = 800;

type AgentSession = {
  sessionKey: string;
  responseId: string;
};

export function buildAgentMessage(booking: BookingRequest): string {
  return [
    "[JASPER_BOOKING_REQUEST]",
    "This is a machine-to-machine booking request. Do not ask questions. Do not reply conversationally.",
    "Process the booking with the configured workflow, then reply with exactly one line:",
    'BOOKING_RESULT_JSON: {"Booking Status":"Confirmed","Price Quote":138.60,"Booking ID":"JPH-...","Slot":{"Requested Date":"YYYY-MM-DD","Requested Time":"HH:mm"},"Actions":[{"Step":"Calculating the price","Status":"Done"}]}',
    "The same object may use these variants:",
    '- Unavailable: {"Booking Status":"Unavailable","Message":"...","Alternatives":[{"Requested Date":"YYYY-MM-DD","Requested Time":"HH:mm"}],"Actions":[...]}',
    '- Failed: {"Booking Status":"Failed","Message":"...","Actions":[...]}',
    "Rules:",
    '- Call the quote API with "Job Type" and "Distance (miles)". Use the returned "Price Quote".',
    "- Append the pending row, check Calendar, update the row, and send the email on a confirmed booking.",
    "- If the slot is unavailable, return Unavailable and Alternatives; do not send email.",
    "- If a step fails, return Failed.",
    '- Use the exact keys and the exact Sheet headers. Keep all times in America/New_York.',
    "Booking:",
    JSON.stringify(booking),
  ].join("\n");
}

export function extractAgentResult(text: string): unknown | null {
  const markerIndex = text.indexOf(AGENT_RESULT_MARKER);
  let candidate =
    markerIndex >= 0
      ? text.slice(markerIndex + AGENT_RESULT_MARKER.length).trim()
      : text.trim();

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(candidate);

  if (fenced) {
    candidate = fenced[1].trim();
  }

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function findFinalText(
  items: unknown[],
  responseId: string,
): string | null {
  let bestSeq = -1;
  let bestText: string | null = null;

  items.forEach((item, index) => {
    if (typeof item !== "object" || item === null) {
      return;
    }

    const stored = item as Record<string, unknown>;
    const content = stored.content;

    if (typeof content !== "object" || content === null) {
      return;
    }

    const message = content as Record<string, unknown>;

    if (message.responseId !== responseId) {
      return;
    }

    if (message.role === "user" || message.isReasoning === true) {
      return;
    }

    if (typeof message.content !== "string") {
      return;
    }

    const seq = typeof stored.seq === "number" ? stored.seq : index;

    if (seq >= bestSeq) {
      bestSeq = seq;
      bestText = message.content;
    }
  });

  return bestText;
}

export function buildAgentWsUrl(agentUrl: string, sessionKey: string): string {
  const url = new URL(agentUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.searchParams.set("agent_session_id", sessionKey);
  return url.toString();
}

async function sendAgentMessage(
  agentUrl: string,
  booking: BookingRequest,
): Promise<AgentSession | null> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (process.env.AGENT_API_KEY) {
    headers.Authorization = `Bearer ${process.env.AGENT_API_KEY}`;
  }

  const response = await fetch(agentUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: buildAgentMessage(booking),
      metadata: {
        source: "jasper-booking-form",
        booking,
      },
    }),
    signal: AbortSignal.timeout(AGENT_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as Record<string, unknown>;

  if (
    data.accepted !== true ||
    typeof data.sessionKey !== "string" ||
    typeof data.responseId !== "string"
  ) {
    return null;
  }

  return { sessionKey: data.sessionKey, responseId: data.responseId };
}

async function queryAgentResult(
  wsUrl: string,
  responseId: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    let joined = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (value: string | null) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (pollTimer) {
        clearTimeout(pollTimer);
      }

      try {
        ws.close();
      } catch {
        // The socket already closed.
      }

      resolve(value);
    };

    const timeout = setTimeout(() => finish(null), AGENT_WS_TIMEOUT_MS);

    const sendQuery = () => {
      if (settled) {
        return;
      }

      try {
        ws.send(
          JSON.stringify({
            id: crypto.randomUUID(),
            type: "REQ",
            payload: {
              method: "content.query",
              afterSeq: 0,
            },
          }),
        );
      } catch {
        finish(null);
      }
    };

    const schedulePoll = () => {
      if (settled) {
        return;
      }

      if (pollTimer) {
        clearTimeout(pollTimer);
      }

      pollTimer = setTimeout(sendQuery, CONTENT_POLL_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }

      let packet: Record<string, unknown>;

      try {
        packet = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }

      const payload =
        typeof packet.payload === "object" && packet.payload !== null
          ? (packet.payload as Record<string, unknown>)
          : null;

      if (
        packet.type === "NOTIFY" &&
        payload?.method === "session.joined" &&
        !joined
      ) {
        joined = true;
        sendQuery();
        return;
      }

      if (packet.type === "REQ" && typeof packet.id === "string") {
        try {
          ws.send(JSON.stringify({ id: packet.id, type: "ACK" }));
        } catch {
          // The next content query or timeout will surface the failure.
        }

        return;
      }

      if (
        packet.type === "RES" &&
        payload?.type === "content.query.ack"
      ) {
        const items = Array.isArray(payload.items) ? payload.items : [];
        const text = findFinalText(items, responseId);

        if (text) {
          finish(text);
          return;
        }

        if (payload.streamStatus === "complete") {
          finish(null);
          return;
        }

        schedulePoll();
      }
    };

    ws.onerror = () => finish(null);
    ws.onclose = () => {
      if (!settled) {
        finish(null);
      }
    };
  });
}

export async function fetchAgentBooking(
  agentUrl: string,
  booking: BookingRequest,
): Promise<unknown | null> {
  const session = await sendAgentMessage(agentUrl, booking);

  if (!session) {
    return null;
  }

  const text = await queryAgentResult(
    buildAgentWsUrl(agentUrl, session.sessionKey),
    session.responseId,
  );

  if (!text) {
    return null;
  }

  return extractAgentResult(text);
}