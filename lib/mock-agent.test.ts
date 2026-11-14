import { describe, expect, it } from "vitest";

import type { BookingRequest } from "./booking";
import {
  getMockAlternatives,
  getMockBookingResult,
  isMockSlotAvailable,
} from "./mock-agent";

const base: BookingRequest = {
  Name: "Jordan Smith",
  Email: "jordan@example.com",
  "Job Type": "Drain cleaning",
  "Distance (miles)": 10,
  "Requested Date": "2026-11-20",
  "Requested Time": "14:00",
};

describe("mock availability", () => {
  it("accepts an open weekday slot", () => {
    const result = getMockBookingResult(base);

    expect(result["Booking Status"]).toBe("Confirmed");

    if (result["Booking Status"] === "Confirmed") {
      expect(result["Price Quote"]).toBe(114);
      expect(result.Slot).toEqual({
        "Requested Date": "2026-11-20",
        "Requested Time": "14:00",
      });
      expect(result["Booking ID"]).toMatch(/^JPH-[A-Z0-9]{8}$/);
      expect(result["Booking Reference"]).toBe(
        result["Booking ID"].slice(-6),
      );
      expect(result.Actions).toHaveLength(5);
      expect(result.Actions.every((action) => action.Status === "Done")).toBe(
        true,
      );
    }
  });

  it("closes Sundays", () => {
    expect(isMockSlotAvailable("2026-11-15", "14:00")).toBe(false);

    const result = getMockBookingResult({
      ...base,
      "Requested Date": "2026-11-15",
    });

    expect(result["Booking Status"]).toBe("Unavailable");

    if (result["Booking Status"] === "Unavailable") {
      expect(result.Alternatives[0]).toEqual({
        "Requested Date": "2026-11-16",
        "Requested Time": "08:00",
      });
      expect(result.Actions.some((action) => action.Status === "Failed")).toBe(
        true,
      );
    }
  });

  it("treats noon as booked", () => {
    expect(isMockSlotAvailable("2026-11-20", "12:00")).toBe(false);

    const result = getMockBookingResult({
      ...base,
      "Requested Time": "12:00",
    });

    expect(result["Booking Status"]).toBe("Unavailable");

    if (result["Booking Status"] === "Unavailable") {
      expect(result.Alternatives).toEqual([
        { "Requested Date": "2026-11-20", "Requested Time": "13:00" },
        { "Requested Date": "2026-11-20", "Requested Time": "14:00" },
        { "Requested Date": "2026-11-20", "Requested Time": "15:00" },
      ]);
    }
  });

  it("rejects the closing hour as an appointment start", () => {
    expect(isMockSlotAvailable("2026-11-20", "18:00")).toBe(false);
  });

  it("returns three alternatives", () => {
    expect(getMockAlternatives("2026-11-20", "14:00")).toHaveLength(3);
  });
});