type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second?: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  const existing = formatters.get(timeZone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatters.set(timeZone, created);
  return created;
}

export function partsInZone(date: Date, timeZone: string): Required<DateParts> {
  const values = Object.fromEntries(
    formatter(timeZone).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

export function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = partsInZone(date, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addDaysToLocalDate(localDate: string, days: number) {
  const [year, month, day] = localDate.split("-").map(Number);
  if (![year, month, day, days].every(Number.isFinite)) throw new Error("INVALID_LOCAL_DATE");
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}

export function zonedDateTimeToUtc(parts: DateParts, timeZone: string) {
  const expected = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0);
  let candidate = expected;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = partsInZone(new Date(candidate), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    candidate -= actualAsUtc - expected;
  }
  return new Date(candidate);
}

export function parseLocalDateTime(localDate: string, localTime: string, timeZone: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) throw new Error("INVALID_LOCAL_DATETIME");
  return zonedDateTimeToUtc({ year, month, day, hour, minute }, timeZone);
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

export function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function weekdayOf(localDate: string) {
  return new Date(`${localDate}T12:00:00Z`).getUTCDay();
}

export function formatInTimeZone(value: string | Date, timeZone: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, ...options }).format(typeof value === "string" ? new Date(value) : value);
}
