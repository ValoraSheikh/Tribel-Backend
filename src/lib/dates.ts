// All booking date comparisons run against the property's calendar (IST),
// never the server's local timezone or raw UTC instants. Booking dates are
// stored as midnight-UTC instants for their calendar day, so formatting the
// instant in IST yields the intended calendar day (IST = UTC+5:30 keeps
// midnight-UTC inside the same calendar day).

export const IST_TIMEZONE = "Asia/Kolkata";

const istKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" calendar key of an instant, in IST. */
export function dateKey(date: Date): string {
  return istKeyFormatter.format(date);
}

/** Today's calendar key in IST. */
export function istTodayKey(): string {
  return dateKey(new Date());
}

/** The booking's stay has begun (check-in day or later), in IST terms. */
export function hasStarted(startDate: Date): boolean {
  return dateKey(startDate) <= istTodayKey();
}

/** The guest has not yet arrived (strictly before the check-in day). */
export function isPreArrival(startDate: Date): boolean {
  return dateKey(startDate) > istTodayKey();
}

/** The checkout day has passed — the stay is over (end-exclusive: on the
 * checkout morning itself the stay is still in progress). */
export function hasEnded(endDate: Date): boolean {
  return istTodayKey() > dateKey(endDate);
}

/** Whole nights between two calendar keys (end-exclusive). */
export function daysBetweenKeys(startKey: string, endKey: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const start = Date.parse(`${startKey}T00:00:00Z`);
  const end = Date.parse(`${endKey}T00:00:00Z`);
  return Math.round((end - start) / msPerDay);
}

/** Nights actually consumed by an ongoing/partial stay, floored at zero and
 * capped at the booking length. */
export function nightsUsed(startDate: Date, endDate: Date): number {
  const todayKey = istTodayKey();
  const startKey = dateKey(startDate);
  const endKey = dateKey(endDate);
  const effectiveEnd = todayKey < endKey ? todayKey : endKey;
  return Math.max(0, daysBetweenKeys(startKey, effectiveEnd));
}
