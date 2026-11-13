export const SERVICES = [
  {
    id: "emergency",
    label: "Emergency repair",
    description: "Burst pipe, major leak, no water",
    multiplier: 1.75,
  },
  {
    id: "water_heater",
    label: "Water heater service",
    description: "Repair, replace, or flush",
    multiplier: 1.6,
  },
  {
    id: "leak_repair",
    label: "Leak or pipe repair",
    description: "Drips, damaged pipes, low pressure",
    multiplier: 1.4,
  },
  {
    id: "general",
    label: "General plumbing",
    description: "Inspections, valves, small jobs",
    multiplier: 1.35,
  },
  {
    id: "fixture",
    label: "Fixture installation",
    description: "Faucets, toilets, sinks, showers",
    multiplier: 1.25,
  },
  {
    id: "drain",
    label: "Drain cleaning",
    description: "Blocked sink, toilet, shower, or main line",
    multiplier: 1.2,
  },
] as const;

export type JobType = (typeof SERVICES)[number]["label"];
export type Service = (typeof SERVICES)[number];

const serviceByLabel = new Map(
  SERVICES.map((service) => [service.label, service] as const),
);

export function isJobType(value: unknown): value is JobType {
  return typeof value === "string" && serviceByLabel.has(value as JobType);
}

export function getService(jobType: JobType): Service {
  const service = serviceByLabel.get(jobType);

  if (!service) {
    throw new Error(`Unknown job type: ${jobType}`);
  }

  return service;
}