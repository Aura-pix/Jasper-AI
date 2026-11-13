export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(year, month - 1, day);

  if (Number.isNaN(value.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(value);
}

export function formatTime(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  const value = new Date(2000, 0, 1, hour, minute);

  if (Number.isNaN(value.getTime())) {
    return time;
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export function formatMiles(distance: number): string {
  const rounded = Number.isInteger(distance) ? distance : Number(distance.toFixed(1));
  return `${rounded} mi`;
}