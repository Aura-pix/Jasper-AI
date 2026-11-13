import { getService, type JobType } from "./services";

export const CALLOUT_FEE_CENTS = 7_500;
export const PER_MILE_CENTS = 200;
export const MIN_DISTANCE_MILES = 1;
export const MAX_DISTANCE_MILES = 50;

export type Quote = {
  "Price Quote": number;
  Currency: "USD";
  Breakdown: {
    "Call-out fee": number;
    Travel: number;
    "Distance (miles)": number;
    "Job Type": JobType;
    Rate: number;
  };
};

export function calculateQuote(jobType: JobType, distance: number): Quote {
  if (!Number.isFinite(distance) || distance < MIN_DISTANCE_MILES) {
    throw new RangeError(`Distance must be at least ${MIN_DISTANCE_MILES} mile.`);
  }

  if (distance > MAX_DISTANCE_MILES) {
    throw new RangeError(`Distance must be ${MAX_DISTANCE_MILES} miles or less.`);
  }

  const service = getService(jobType);
  const travelCents = Math.round(distance * PER_MILE_CENTS);
  const subtotalCents = CALLOUT_FEE_CENTS + travelCents;
  const priceCents = Math.round(subtotalCents * service.multiplier);

  return {
    "Price Quote": priceCents / 100,
    Currency: "USD",
    Breakdown: {
      "Call-out fee": CALLOUT_FEE_CENTS / 100,
      Travel: travelCents / 100,
      "Distance (miles)": distance,
      "Job Type": jobType,
      Rate: service.multiplier,
    },
  };
}