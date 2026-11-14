import { describe, expect, it } from "vitest";

import type { BookingRequest } from "./booking";
import {
  AGENT_RESULT_MARKER,
  buildAgentMessage,
  buildAgentWsUrl,
  extractAgentResult,
  findAnyFinalText,
  findFinalText,
} from "./agent-client";

const booking: BookingRequest = {
  Name: "Jordan Smith",
  Email: "jordan@example.com",
  "Job Type": "Leak or pipe repair",
  "Distance (miles)": 12,
  "Requested Date": "2026-11-20",
  "Requested Time": "14:00",
};

const result = {
  "Booking Status": "Confirmed",
  "Price Quote": 138.6,
  "Booking ID": "JPH-TEST1234",
  Slot: {
    "Requested Date": "2026-11-20",
    "Requested Time": "14:00",
  },
  Actions: [{ Step: "Calculating the price", Status: "Done" }],
};

describe("buildAgentMessage", () => {
  it("includes the machine marker and the exact booking keys", () => {
    const message = buildAgentMessage(booking);

    expect(message).toContain("[JASPER_BOOKING_REQUEST]");
    expect(message).toContain(AGENT_RESULT_MARKER);
    expect(message).toContain('"Job Type":"Leak or pipe repair"');
    expect(message).toContain('"Distance (miles)":12');
    expect(message).toContain('"Requested Date":"2026-11-20"');
    expect(message).toContain('"Requested Time":"14:00"');
    expect(message).toContain('"Timezone":"America/New_York"');
    expect(message).toContain("America/New_York");
  });
});

describe("extractAgentResult", () => {
  it("parses marker-prefixed JSON", () => {
    expect(
      extractAgentResult(`Some prose\n${AGENT_RESULT_MARKER} ${JSON.stringify(result)}`),
    ).toEqual(result);
  });

  it("parses plain JSON", () => {
    expect(extractAgentResult(JSON.stringify(result))).toEqual(result);
  });

  it("parses fenced JSON", () => {
    expect(
      extractAgentResult(`\`\`\`json\n${JSON.stringify(result)}\n\`\`\``),
    ).toEqual(result);
  });

  it("returns null for prose without JSON", () => {
    expect(extractAgentResult("The booking is confirmed.")).toBeNull();
  });
});

describe("findFinalText", () => {
  it("selects the final assistant text for the response", () => {
    const items = [
      {
        seq: 1,
        content: {
          type: "TXT",
          role: "user",
          content: "booking request",
        },
      },
      {
        seq: 2,
        content: {
          type: "TXT",
          responseId: "response-1",
          content: "thinking",
          isReasoning: true,
        },
      },
      {
        seq: 3,
        content: {
          type: "TXT",
          responseId: "response-1",
          content: "BOOKING_RESULT_JSON: {}",
          isReasoning: false,
        },
      },
      {
        seq: 4,
        content: {
          type: "TXT",
          responseId: "response-2",
          content: "other response",
        },
      },
    ];

    expect(findFinalText(items, "response-1")).toBe("BOOKING_RESULT_JSON: {}");
  });

  it("returns null when the response has no text", () => {
    expect(findFinalText([], "response-1")).toBeNull();
  });
});

describe("findAnyFinalText", () => {
  it("falls back to a final text with a different response id", () => {
    const items = [
      {
        seq: 1,
        content: {
          type: "TXT",
          role: "user",
          content: "booking request",
        },
      },
      {
        seq: 2,
        content: {
          type: "TXT",
          responseId: "other-response",
          content: 'BOOKING_RESULT_JSON: {"Booking Status":"Confirmed"}',
        },
      },
    ];

    expect(findAnyFinalText(items)).toBe(
      'BOOKING_RESULT_JSON: {"Booking Status":"Confirmed"}',
    );
  });
});

describe("buildAgentWsUrl", () => {
  it("uses the agent host and the ws session path", () => {
    expect(
      buildAgentWsUrl(
        "https://bobmetsnbddq.run.agentplace.io/api/send-message",
        "session-1",
      ),
    ).toBe(
      "wss://bobmetsnbddq.run.agentplace.io/ws?agent_session_id=session-1",
    );
  });
});