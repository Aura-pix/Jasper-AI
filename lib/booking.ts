import type { JobType } from "./services";

export const BUSINESS_TIMEZONE = "America/New_York";
export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 18;

export const TIME_SLOTS = Array.from(
  { length: CLOSE_HOUR - OPEN_HOUR },
  (_, index) => {
    const hour = OPEN_HOUR + index;
    return `${String(hour).padStart(2, "0")}:00`;
  },
);

export type BookingRequest = {
  Name: string;
  Email: string;
  "Job Type": JobType;
  "Distance (miles)": number;
  "Requested Date": string;
  "Requested Time": string;
};

export type QuoteRequest = Pick<
  BookingRequest,
  "Job Type" | "Distance (miles)"
>;

export type BookingSlot = {
  "Requested Date": string;
  "Requested Time": string;
};

export type BookingStatus =
  | "Pending Calendar Check"
  | "Confirmed"
  | "Unavailable"
  | "Failed";

export type ActionStatus = "Active" | "Done" | "Failed";

export type AgentAction = {
  Step: string;
  Status: ActionStatus;
};

export type ConfirmedBooking = {
  "Booking Status": "Confirmed";
  "Price Quote": number;
  "Booking ID": string;
  Slot: BookingSlot;
  Actions: AgentAction[];
};

export type UnavailableBooking = {
  "Booking Status": "Unavailable";
  Message: string;
  Alternatives: BookingSlot[];
  Actions: AgentAction[];
};

export type FailedBooking = {
  "Booking Status": "Failed";
  Message: string;
  Actions: AgentAction[];
};

export type BookingResult =
  | ConfirmedBooking
  | UnavailableBooking
  | FailedBooking;