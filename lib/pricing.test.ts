import { describe, expect, it } from "vitest";

import { calculateQuote, MAX_DISTANCE_MILES } from "./pricing";

describe("calculateQuote", () => {
  it.each([
    ["Emergency repair", 166.25],
    ["Water heater service", 152],
    ["Leak or pipe repair", 133],
    ["General plumbing", 128.25],
    ["Fixture installation", 118.75],
    ["Drain cleaning", 114],
  ] as const)("prices %s at 10 miles", (jobType, price) => {
    expect(calculateQuote(jobType, 10)["Price Quote"]).toBe(price);
  });

  it("returns the breakdown for the estimate", () => {
    const quote = calculateQuote("Leak or pipe repair", 12);

    expect(quote["Price Quote"]).toBe(138.6);
    expect(quote.Currency).toBe("USD");
    expect(quote.Breakdown["Call-out fee"]).toBe(75);
    expect(quote.Breakdown.Travel).toBe(24);
    expect(quote.Breakdown["Distance (miles)"]).toBe(12);
    expect(quote.Breakdown["Job Type"]).toBe("Leak or pipe repair");
    expect(quote.Breakdown.Rate).toBe(1.4);
  });

  it("rounds travel to the nearest cent", () => {
    const quote = calculateQuote("General plumbing", 12.345);

    expect(quote.Breakdown.Travel).toBe(24.69);
    expect(quote["Price Quote"]).toBe(134.58);
  });

  it("rejects distances outside the allowed range", () => {
    expect(() => calculateQuote("General plumbing", 0)).toThrow(RangeError);
    expect(() => calculateQuote("General plumbing", 0.5)).toThrow(RangeError);
    expect(() => calculateQuote("General plumbing", Number.NaN)).toThrow(
      RangeError,
    );
    expect(() =>
      calculateQuote("General plumbing", MAX_DISTANCE_MILES + 1),
    ).toThrow(RangeError);
  });
});