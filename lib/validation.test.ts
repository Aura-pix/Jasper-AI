import { describe, expect, it } from "vitest";

import type { BookingRequest } from "./booking";
import { validateBookingInput, validateQuoteInput } from "./validation";

const validBooking: BookingRequest = {
  Name: "Jordan Smith",
  Email: "jordan@example.com",
  "Job Type": "Drain cleaning",
  "Distance (miles)": 10,
  "Requested Date": "2026-11-20",
  "Requested Time": "14:00",
};

describe("validateQuoteInput", () => {
  it("accepts a valid quote request", () => {
    expect(
      validateQuoteInput({
        "Job Type": "Drain cleaning",
        "Distance (miles)": 10,
      }),
    ).toEqual({
      ok: true,
      data: { "Job Type": "Drain cleaning", "Distance (miles)": 10 },
    });
  });

  it("rejects an unknown job type", () => {
    const result = validateQuoteInput({
      "Job Type": "Plumbing",
      "Distance (miles)": 10,
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors["Job Type"]).toBe("Choose a job type.");
    }
  });

  it("rejects a distance below one mile", () => {
    const result = validateQuoteInput({
      "Job Type": "Drain cleaning",
      "Distance (miles)": 0,
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors["Distance (miles)"]).toBe(
        "Enter a distance of at least 1 mile.",
      );
    }
  });

  it("rejects a distance above the limit", () => {
    const result = validateQuoteInput({
      "Job Type": "Drain cleaning",
      "Distance (miles)": 51,
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors["Distance (miles)"]).toBe(
        "Enter a distance of 50 miles or less.",
      );
    }
  });

  it("rejects a non-numeric distance", () => {
    const result = validateQuoteInput({
      "Job Type": "Drain cleaning",
      "Distance (miles)": "10",
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors["Distance (miles)"]).toBe(
        "Enter a distance between 1 and 50 miles.",
      );
    }
  });
});

describe("validateBookingInput", () => {
  it("accepts a valid booking", () => {
    const result = validateBookingInput(validBooking, "2026-11-13");

    expect(result.ok).toBe(true);
  });

  it("accepts the final one-hour appointment start before closing", () => {
    const result = validateBookingInput(
      { ...validBooking, "Requested Time": "17:00" },
      "2026-11-13",
    );

    expect(result.ok).toBe(true);
  });

  it("trims the name and email", () => {
    const result = validateBookingInput(
      {
        ...validBooking,
        Name: "  Jordan Smith  ",
        Email: "  jordan@example.com  ",
      },
      "2026-11-13",
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data.Name).toBe("Jordan Smith");
      expect(result.data.Email).toBe("jordan@example.com");
    }
  });

  it("rejects a past date", () => {
    const result = validateBookingInput(
      { ...validBooking, "Requested Date": "2026-11-12" },
      "2026-11-13",
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors["Requested Date"]).toBe(
        "Choose a date from today onward.",
      );
    }
  });

  it("rejects an invalid calendar date", () => {
    const result = validateBookingInput(
      { ...validBooking, "Requested Date": "2026-02-30" },
      "2026-11-13",
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors["Requested Date"]).toBe(
        "Choose a requested date.",
      );
    }
  });

  it("rejects the closing hour as an appointment start", () => {
    const result = validateBookingInput(
      { ...validBooking, "Requested Time": "18:00" },
      "2026-11-13",
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors["Requested Time"]).toBe(
        "Choose an appointment start between 8:00 AM and 5:00 PM.",
      );
    }
  });

  it("rejects a time outside business hours", () => {
    const result = validateBookingInput(
      { ...validBooking, "Requested Time": "19:00" },
      "2026-11-13",
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors["Requested Time"]).toBe(
        "Choose an appointment start between 8:00 AM and 5:00 PM.",
      );
    }
  });

  it("rejects a malformed email", () => {
    const result = validateBookingInput(
      { ...validBooking, Email: "jordan" },
      "2026-11-13",
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors.Email).toBe("Enter a valid email address.");
    }
  });
});