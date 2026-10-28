const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** A duration in the words people use: "2 days", "5 hours", "12 minutes", "40 seconds". */
export function spell(ms: number): string {
  const t = Math.max(0, ms);
  if (t >= 2 * day) return plural(Math.floor(t / day), "day");
  if (t >= day) return `1 day${t >= day + hour ? ` ${plural(Math.floor((t - day) / hour), "hour")}` : ""}`;
  if (t >= 2 * hour) return plural(Math.floor(t / hour), "hour");
  if (t >= hour) return `1 hour${t >= hour + minute ? ` ${plural(Math.floor((t - hour) / minute), "minute")}` : ""}`;
  if (t >= 2 * minute) return plural(Math.ceil(t / minute), "minute");
  if (t >= minute) return "1 minute";
  return plural(Math.max(1, Math.ceil(t / 1000)), "second");
}

/** A short countdown: "0:42", "12:05", "1:02:05". */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const yearFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** An exact moment in the viewer's own time zone: "Today, 21:00", "Thu 9 Oct, 21:00". */
export function moment(ms: number, now = Date.now()): string {
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / day);
  const time = timeFormat.format(ms);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days === -1) return `Yesterday, ${time}`;
  if (Math.abs(days) < 300) return `${dateFormat.format(ms)}, ${time}`;
  return `${yearFormat.format(ms)}, ${time}`;
}

/** The same moment inside a sentence: "today at 21:00", "Thu 9 Oct at 21:00". */
export function momentInline(ms: number, now = Date.now()): string {
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / day);
  const time = timeFormat.format(ms);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days === -1) return `yesterday at ${time}`;
  return `${Math.abs(days) < 300 ? dateFormat.format(ms) : yearFormat.format(ms)} at ${time}`;
}

/** Rounds a moment up to the next quarter hour, so closing times read cleanly. */
export function roundUp(ms: number, step = 15 * minute): number {
  return Math.ceil(ms / step) * step;
}

export const durations = { minute, hour, day };
