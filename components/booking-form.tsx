"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  TIME_SLOTS,
  type ActionStatus,
  type AgentAction,
  type BookingRequest,
  type BookingResult,
  type BookingSlot,
  type ConfirmedBooking,
} from "@/lib/booking";
import {
  formatCurrency,
  formatDate,
  formatMiles,
  formatTime,
} from "@/lib/format";
import {
  MAX_DISTANCE_MILES,
  MIN_DISTANCE_MILES,
  PER_MILE_CENTS,
  type Quote,
} from "@/lib/pricing";
import { SERVICES } from "@/lib/services";
import {
  getTodayInNewYork,
  validateBookingInput,
  validateQuoteInput,
  type FieldErrors,
} from "@/lib/validation";

type FormValues = {
  Name: string;
  Email: string;
  "Job Type": string;
  "Distance (miles)": string;
  "Requested Date": string;
  "Requested Time": string;
};

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "unavailable"; message: string; alternatives: BookingSlot[] }
  | { kind: "failed"; message: string };

const EMPTY_FORM: FormValues = {
  Name: "",
  Email: "",
  "Job Type": "",
  "Distance (miles)": "",
  "Requested Date": "",
  "Requested Time": "",
};

const FIELD_ORDER: (keyof FormValues)[] = [
  "Name",
  "Email",
  "Job Type",
  "Distance (miles)",
  "Requested Date",
  "Requested Time",
];

const FIELD_IDS: Record<keyof FormValues, string> = {
  Name: "field-name",
  Email: "field-email",
  "Job Type": "field-job-type",
  "Distance (miles)": "field-distance",
  "Requested Date": "field-requested-date",
  "Requested Time": "field-requested-time",
};

const subscribeToDayChange = () => () => {};

function getTodaySnapshot() {
  return getTodayInNewYork();
}

function getTodayServerSnapshot() {
  return "";
}

const inputClass =
  "h-11 w-full rounded-control border border-line bg-surface px-3 text-[15px] text-ink placeholder:text-muted/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted";

const primaryButtonClass =
  "inline-flex h-12 items-center justify-center rounded-control bg-accent px-5 text-[15px] font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClass =
  "inline-flex h-12 items-center justify-center rounded-control border border-line bg-surface px-4 text-[14px] font-medium text-ink transition-colors hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50";

const chipClass =
  "inline-flex h-9 items-center justify-center rounded-control border border-line bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

function parseSseFrame(frame: string): { event: string; data: unknown } | null {
  let event = "message";
  const data: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }

  if (data.length === 0) {
    return null;
  }

  try {
    return { event, data: JSON.parse(data.join("\n")) };
  } catch {
    return null;
  }
}

export default function BookingForm() {
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quotePending, setQuotePending] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [confirmed, setConfirmed] = useState<ConfirmedBooking | null>(null);
  const [submitted, setSubmitted] = useState<BookingRequest | null>(null);
  const today = useSyncExternalStore(
    subscribeToDayChange,
    getTodaySnapshot,
    getTodayServerSnapshot,
  );

  const panelRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSelectElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const quoteRequestId = useRef(0);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const submitting = status.kind === "submitting";

  function updateField<K extends keyof FormValues>(
    key: K,
    value: FormValues[K],
  ) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      if (!previous[key]) {
        return previous;
      }

      const next = { ...previous };
      delete next[key];
      return next;
    });

    if (key === "Job Type" || key === "Distance (miles)") {
      quoteRequestId.current += 1;
      setQuote(null);
      setQuoteError(null);
      setQuotePending(false);
    }

    if (status.kind === "unavailable" || status.kind === "failed") {
      setStatus({ kind: "idle" });
      setActions([]);
    }
  }

  function focusField(key: keyof FormValues) {
    document.getElementById(FIELD_IDS[key])?.focus();
  }

  async function handleGetPrice() {
    if (quotePending || submitting) {
      return;
    }

    const distance =
      form["Distance (miles)"].trim() === ""
        ? Number.NaN
        : Number(form["Distance (miles)"]);
    const validation = validateQuoteInput({
      "Job Type": form["Job Type"],
      "Distance (miles)": distance,
    });

    if (!validation.ok) {
      setErrors((previous) => ({ ...previous, ...validation.errors }));
      setQuote(null);
      setQuoteError(null);
      focusField(
        validation.errors["Job Type"] ? "Job Type" : "Distance (miles)",
      );
      return;
    }

    setErrors((previous) => {
      const next = { ...previous };
      delete next["Job Type"];
      delete next["Distance (miles)"];
      return next;
    });

    const requestId = quoteRequestId.current + 1;
    quoteRequestId.current = requestId;
    setQuotePending(true);
    setQuoteError(null);

    try {
      const response = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.data),
      });
      const data = (await response.json()) as Partial<Quote> & {
        error?: string;
        fields?: FieldErrors;
      };

      if (quoteRequestId.current !== requestId) {
        return;
      }

      if (!response.ok) {
        setQuote(null);

        if (data.fields) {
          setErrors((previous) => ({ ...previous, ...data.fields }));
          const first = FIELD_ORDER.find((key) => data.fields?.[key]);

          if (first) {
            focusField(first);
          }
        } else {
          setQuoteError(data.error ?? "We couldn't get a price. Try again.");
        }

        return;
      }

      setQuote(data as Quote);

      if (window.matchMedia("(max-width: 1023px)").matches) {
        requestAnimationFrame(() =>
          panelRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        );
      }
    } catch {
      if (quoteRequestId.current === requestId) {
        setQuote(null);
        setQuoteError("We couldn't get a price. Try again.");
      }
    } finally {
      if (quoteRequestId.current === requestId) {
        setQuotePending(false);
      }
    }
  }

  async function handleSubmit() {
    if (submitting) {
      return;
    }

    const distance =
      form["Distance (miles)"].trim() === ""
        ? Number.NaN
        : Number(form["Distance (miles)"]);
    const validation = validateBookingInput(
      {
        Name: form.Name,
        Email: form.Email,
        "Job Type": form["Job Type"],
        "Distance (miles)": distance,
        "Requested Date": form["Requested Date"],
        "Requested Time": form["Requested Time"],
      },
      today || undefined,
    );

    if (!validation.ok) {
      setErrors(validation.errors);
      setStatus({ kind: "idle" });
      const first = FIELD_ORDER.find((key) => validation.errors[key]);

      if (first) {
        focusField(first);
      }

      return;
    }

    setErrors({});
    setSubmitted(validation.data);
    setStatus({ kind: "submitting" });
    setActions([]);
    setConfirmed(null);
    setQuoteError(null);

    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() =>
        panelRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      );
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.data),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          fields?: FieldErrors;
        } | null;

        if (data?.fields) {
          const fields = data.fields;
          setErrors(fields);
          setStatus({ kind: "idle" });
          const first = FIELD_ORDER.find((key) => fields[key]);

          if (first) {
            focusField(first);
          }

          return;
        }

        setStatus({
          kind: "failed",
          message:
            data?.error ??
            "We couldn't confirm this booking. Nothing was charged. Try again.",
        });
        return;
      }

      if (!response.body) {
        setStatus({
          kind: "failed",
          message:
            "We couldn't confirm this booking. Nothing was charged. Try again.",
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: BookingResult | null = null;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          if (!frame.trim()) {
            continue;
          }

          const parsed = parseSseFrame(frame);

          if (!parsed) {
            continue;
          }

          if (parsed.event === "action") {
            const action = parsed.data as AgentAction;

            if (action.Step && action.Status) {
              setActions((previous) => {
                const index = previous.findIndex(
                  (item) => item.Step === action.Step,
                );

                if (index === -1) {
                  return [...previous, action];
                }

                const next = [...previous];
                next[index] = action;
                return next;
              });
            }
          } else if (parsed.event === "result") {
            result = parsed.data as BookingResult;
          }
        }
      }

      if (!result) {
        setStatus({
          kind: "failed",
          message:
            "We couldn't confirm this booking. Nothing was charged. Try again.",
        });
        return;
      }

      setActions(result.Actions);

      if (result["Booking Status"] === "Confirmed") {
        setConfirmed(result);
        setStatus({ kind: "idle" });
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (result["Booking Status"] === "Unavailable") {
        setStatus({
          kind: "unavailable",
          message: result.Message,
          alternatives: result.Alternatives,
        });
        requestAnimationFrame(() => timeRef.current?.focus());
      } else {
        setStatus({ kind: "failed", message: result.Message });
      }
    } catch {
      if (!controller.signal.aborted) {
        setStatus({
          kind: "failed",
          message:
            "We couldn't confirm this booking. Nothing was charged. Try again.",
        });
      }
    } finally {
      abortRef.current = null;
    }
  }

  function chooseAlternative(slot: BookingSlot) {
    setForm((previous) => ({
      ...previous,
      "Requested Date": slot["Requested Date"],
      "Requested Time": slot["Requested Time"],
    }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next["Requested Date"];
      delete next["Requested Time"];
      return next;
    });
    setStatus({ kind: "idle" });
    setActions([]);
  }

  function chooseAnotherTime() {
    setStatus({ kind: "idle" });
    setActions([]);
    requestAnimationFrame(() => timeRef.current?.focus());
  }

  function changeDetails() {
    setStatus({ kind: "idle" });
    setActions([]);
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  function handleReset() {
    abortRef.current?.abort();
    setForm(EMPTY_FORM);
    setErrors({});
    setQuote(null);
    setQuotePending(false);
    setQuoteError(null);
    setStatus({ kind: "idle" });
    setActions([]);
    setConfirmed(null);
    setSubmitted(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  if (confirmed && submitted) {
    return (
      <SuccessView
        result={confirmed}
        request={submitted}
        onReset={handleReset}
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,560px)_320px] lg:items-start">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleGetPrice();
        }}
        noValidate
        className="rounded-card border border-line bg-surface p-5 sm:p-6"
      >
        <h2 className="text-[16px] font-semibold leading-6 text-ink">
          Booking details
        </h2>

        {errors.form && (
          <p className="mt-3 text-[13px] leading-5 text-danger" aria-live="polite">
            {errors.form}
          </p>
        )}

        <div className="mt-5 space-y-5">
          <div>
            <label
              htmlFor={FIELD_IDS.Name}
              className="block text-[14px] font-medium leading-5 text-ink"
            >
              Name
            </label>
            <input
              ref={nameRef}
              id={FIELD_IDS.Name}
              name="Name"
              type="text"
              autoComplete="name"
              value={form.Name}
              onChange={(event) => updateField("Name", event.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(errors.Name)}
              aria-describedby={errors.Name ? "error-name" : undefined}
              placeholder="Jordan Smith"
              className={`${inputClass} mt-1.5`}
            />
            {errors.Name && (
              <p id="error-name" className="mt-1.5 text-[13px] leading-5 text-danger">
                {errors.Name}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor={FIELD_IDS.Email}
              className="block text-[14px] font-medium leading-5 text-ink"
            >
              Email
            </label>
            <input
              id={FIELD_IDS.Email}
              name="Email"
              type="email"
              autoComplete="email"
              value={form.Email}
              onChange={(event) => updateField("Email", event.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(errors.Email)}
              aria-describedby={errors.Email ? "error-email" : undefined}
              placeholder="you@example.com"
              className={`${inputClass} mt-1.5`}
            />
            {errors.Email && (
              <p id="error-email" className="mt-1.5 text-[13px] leading-5 text-danger">
                {errors.Email}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor={FIELD_IDS["Job Type"]}
              className="block text-[14px] font-medium leading-5 text-ink"
            >
              Job Type
            </label>
            <select
              id={FIELD_IDS["Job Type"]}
              name="Job Type"
              value={form["Job Type"]}
              onChange={(event) => updateField("Job Type", event.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(errors["Job Type"])}
              aria-describedby={
                errors["Job Type"] ? "error-job-type" : "help-job-type"
              }
              className={`${inputClass} mt-1.5`}
            >
              <option value="">Select a job type</option>
              {SERVICES.map((service) => (
                <option key={service.id} value={service.label}>
                  {service.label}
                </option>
              ))}
            </select>
            <p id="help-job-type" className="mt-1.5 text-[13px] leading-5 text-muted">
              Not sure? Choose General plumbing.
            </p>
            {errors["Job Type"] && (
              <p id="error-job-type" className="mt-1.5 text-[13px] leading-5 text-danger">
                {errors["Job Type"]}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor={FIELD_IDS["Distance (miles)"]}
              className="block text-[14px] font-medium leading-5 text-ink"
            >
              Distance (miles)
            </label>
            <input
              id={FIELD_IDS["Distance (miles)"]}
              name="Distance (miles)"
              type="number"
              inputMode="numeric"
              min={MIN_DISTANCE_MILES}
              max={MAX_DISTANCE_MILES}
              step="1"
              value={form["Distance (miles)"]}
              onChange={(event) =>
                updateField("Distance (miles)", event.target.value)
              }
              disabled={submitting}
              aria-invalid={Boolean(errors["Distance (miles)"])}
              aria-describedby={
                errors["Distance (miles)"]
                  ? "error-distance"
                  : "help-distance"
              }
              placeholder="0"
              className={`${inputClass} mt-1.5`}
            />
            <p id="help-distance" className="mt-1.5 text-[13px] leading-5 text-muted">
              One-way distance in miles. Used for the travel fee.
            </p>
            {errors["Distance (miles)"] && (
              <p id="error-distance" className="mt-1.5 text-[13px] leading-5 text-danger">
                {errors["Distance (miles)"]}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor={FIELD_IDS["Requested Date"]}
              className="block text-[14px] font-medium leading-5 text-ink"
            >
              Requested Date
            </label>
            <input
              id={FIELD_IDS["Requested Date"]}
              name="Requested Date"
              type="date"
              min={today || undefined}
              value={form["Requested Date"]}
              onChange={(event) =>
                updateField("Requested Date", event.target.value)
              }
              disabled={submitting}
              aria-invalid={Boolean(errors["Requested Date"])}
              aria-describedby={
                errors["Requested Date"]
                  ? "error-requested-date"
                  : "help-requested-date"
              }
              className={`${inputClass} mt-1.5`}
            />
            <p id="help-requested-date" className="mt-1.5 text-[13px] leading-5 text-muted">
              We&apos;ll check availability before confirming.
            </p>
            {errors["Requested Date"] && (
              <p id="error-requested-date" className="mt-1.5 text-[13px] leading-5 text-danger">
                {errors["Requested Date"]}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor={FIELD_IDS["Requested Time"]}
              className="block text-[14px] font-medium leading-5 text-ink"
            >
              Requested Time
            </label>
            <select
              ref={timeRef}
              id={FIELD_IDS["Requested Time"]}
              name="Requested Time"
              value={form["Requested Time"]}
              onChange={(event) =>
                updateField("Requested Time", event.target.value)
              }
              disabled={submitting}
              aria-invalid={Boolean(errors["Requested Time"])}
              aria-describedby={
                errors["Requested Time"]
                  ? "error-requested-time"
                  : "help-requested-time"
              }
              className={`${inputClass} mt-1.5`}
            >
              <option value="">Select a time</option>
              {TIME_SLOTS.map((time) => (
                <option key={time} value={time}>
                  {formatTime(time)}
                </option>
              ))}
            </select>
            <p id="help-requested-time" className="mt-1.5 text-[13px] leading-5 text-muted">
              8:00 AM–5:00 PM, hourly.
            </p>
            {errors["Requested Time"] && (
              <p id="error-requested-time" className="mt-1.5 text-[13px] leading-5 text-danger">
                {errors["Requested Time"]}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6">
          <button
            type="submit"
            disabled={quotePending || submitting}
            className={`${primaryButtonClass} w-full`}
          >
            {quotePending ? "Getting price…" : "Get price"}
          </button>
        </div>
      </form>

      <aside
        ref={panelRef}
        className="rounded-card border border-line bg-surface p-5 lg:sticky lg:top-6"
      >
        {status.kind !== "idle" ? (
          <StatusPanel
            status={status}
            actions={actions}
            onRetry={() => void handleSubmit()}
            onChangeDetails={changeDetails}
            onChooseTime={chooseAnotherTime}
            onChooseAlternative={chooseAlternative}
          />
        ) : quote ? (
          <QuotePanel
            quote={quote}
            pending={quotePending}
            onSubmit={() => void handleSubmit()}
          />
        ) : (
          <EmptyPanel error={quoteError} />
        )}
      </aside>
    </div>
  );
}

function EmptyPanel({ error }: { error: string | null }) {
  return (
    <div>
      <h2 className="text-[16px] font-semibold leading-6 text-ink">
        Estimated price
      </h2>
      <p className="mt-2 text-[14px] leading-5 text-muted">
        Enter a job type and distance to see an estimate.
      </p>
      {error && (
        <p className="mt-3 text-[13px] leading-5 text-danger" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}

function QuotePanel({
  quote,
  pending,
  onSubmit,
}: {
  quote: Quote;
  pending: boolean;
  onSubmit: () => void;
}) {
  return (
    <div>
      <h2 className="text-[16px] font-semibold leading-6 text-ink">
        Estimated price
      </h2>
      <p className="mt-1 text-[32px] font-semibold leading-9 tracking-[-0.02em] tabular-nums text-ink">
        {formatCurrency(quote["Price Quote"])}
      </p>
      <p className="mt-2 text-[13px] leading-5 text-muted">
        Estimate covers call-out and labor. Parts are quoted separately.
      </p>
      <div className="mt-4 space-y-2 border-t border-line pt-4 text-[14px] leading-5">
        <div className="flex justify-between gap-4">
          <span className="text-muted">Call-out fee</span>
          <span className="tabular-nums text-ink">
            {formatCurrency(quote.Breakdown["Call-out fee"])}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted">
            Travel ({formatMiles(quote.Breakdown["Distance (miles)"])} ×{" "}
            {formatCurrency(PER_MILE_CENTS / 100)})
          </span>
          <span className="tabular-nums text-ink">
            {formatCurrency(quote.Breakdown.Travel)}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted">
            {quote.Breakdown["Job Type"]} rate
          </span>
          <span className="tabular-nums text-ink">
            ×{quote.Breakdown.Rate.toFixed(2)}
          </span>
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-4 text-muted">Prices in USD.</p>
      <button
        type="button"
        onClick={onSubmit}
        disabled={pending}
        className={`${primaryButtonClass} mt-5 w-full`}
      >
        Request booking
      </button>
    </div>
  );
}

function StatusPanel({
  status,
  actions,
  onRetry,
  onChangeDetails,
  onChooseTime,
  onChooseAlternative,
}: {
  status: Exclude<Status, { kind: "idle" }>;
  actions: AgentAction[];
  onRetry: () => void;
  onChangeDetails: () => void;
  onChooseTime: () => void;
  onChooseAlternative: (slot: BookingSlot) => void;
}) {
  const activeAction = actions.find((action) => action.Status === "Active");
  const displayActions =
    actions.length > 0
      ? actions
      : status.kind === "submitting"
        ? [{ Step: "Working on your booking", Status: "Active" as const }]
        : [];

  return (
    <div>
      <h2 className="text-[16px] font-semibold leading-6 text-ink">
        Booking status
      </h2>
      <p className="sr-only" aria-live="polite">
        {activeAction?.Step ?? ""}
      </p>
      {displayActions.length > 0 && (
        <ol className="mt-4 space-y-3">
          {displayActions.map((action) => (
            <li key={action.Step} className="flex items-start gap-3">
              <StepIcon status={action.Status} />
              <span
                className={`text-[14px] leading-5 ${
                  action.Status === "Active"
                    ? "text-ink"
                    : action.Status === "Failed"
                      ? "text-danger"
                      : "text-ink"
                }`}
              >
                {action.Step}
              </span>
            </li>
          ))}
        </ol>
      )}

      {status.kind === "unavailable" && (
        <div className="mt-4 border-t border-line pt-4" aria-live="polite">
          <p className="text-[14px] leading-5 text-warning">{status.message}</p>
          {status.alternatives.length > 0 && (
            <div className="mt-3">
              <p className="text-[13px] font-medium leading-5 text-ink">
                Next available
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {status.alternatives.map((slot) => (
                  <button
                    key={`${slot["Requested Date"]}-${slot["Requested Time"]}`}
                    type="button"
                    onClick={() => onChooseAlternative(slot)}
                    className={chipClass}
                  >
                    {formatDate(slot["Requested Date"])} ·{" "}
                    {formatTime(slot["Requested Time"])}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onChooseTime}
            className={`${secondaryButtonClass} mt-3 w-full`}
          >
            Choose another time
          </button>
        </div>
      )}

      {status.kind === "failed" && (
        <div className="mt-4 border-t border-line pt-4" aria-live="polite">
          <p className="text-[14px] leading-5 text-danger">{status.message}</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={onRetry}
              className={`${primaryButtonClass} flex-1`}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={onChangeDetails}
              className={`${secondaryButtonClass} flex-1`}
            >
              Change details
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: ActionStatus }) {
  if (status === "Active") {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent"
      />
    );
  }

  if (status === "Done") {
    return <CheckIcon className="mt-0.5 size-4 shrink-0 text-accent" />;
  }

  return <XIcon className="mt-0.5 size-4 shrink-0 text-danger" />;
}

function SuccessView({
  result,
  request,
  onReset,
}: {
  result: ConfirmedBooking;
  request: BookingRequest;
  onReset: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section className="max-w-[560px] rounded-card border border-line bg-surface p-6">
      <div className="flex size-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <CheckMark className="size-5" />
      </div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 text-[22px] font-semibold leading-7 text-ink outline-none"
      >
        Booking confirmed
      </h2>
      <p className="mt-2 text-[15px] leading-6 text-muted">
        We sent a confirmation to {request.Email}.
      </p>
      <dl className="mt-5 divide-y divide-line border-y border-line text-[14px] leading-5">
        <SummaryRow
          label="Date"
          value={formatDate(result.Slot["Requested Date"])}
        />
        <SummaryRow
          label="Time"
          value={formatTime(result.Slot["Requested Time"])}
        />
        <SummaryRow label="Job Type" value={request["Job Type"]} />
        <SummaryRow
          label="Distance"
          value={formatMiles(request["Distance (miles)"])}
        />
        <SummaryRow
          label="Price quote"
          value={formatCurrency(result["Price Quote"])}
        />
      </dl>
      <p className="mt-3 text-[12px] leading-4 text-muted">
        Booking ID: {result["Booking ID"]}
      </p>
      <button
        type="button"
        onClick={onReset}
        className={`${secondaryButtonClass} mt-5 w-full`}
      >
        Book another job
      </button>
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

function CheckMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path
        d="M3.5 8.6 6.4 11.4 12.5 4.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5.2 8.2 7.1 10l3.7-3.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="m5.6 5.6 4.8 4.8M10.4 5.6l-4.8 4.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}