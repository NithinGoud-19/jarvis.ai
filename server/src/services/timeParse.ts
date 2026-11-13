/**
 * Turns the user's words ("in 10 minutes", "tomorrow 9am", "friday 6 pm") into a real Date.
 *
 * 📘 LESSON: Don't let a small AI do maths
 * A 4B model often gets "what time is 45 minutes after 11:30?" wrong. So the AI only copies
 * the user's words into the tool call, and THIS code, using the chrono-node library,
 * calculates the exact time. Rule of thumb: AI for understanding language, code for exact work.
 *
 * chrono "en.GB" reads dates day-first (13/11 = 13 November), which is how India writes them.
 * forwardDate: true → "6 pm" when it's already 8 pm means TOMORROW 6 pm, not 2 hours ago.
 */
import * as chrono from "chrono-node";

export type ParsedWhen = { date: Date; matched: string };

/** A day with no time ("tomorrow", "on friday") → this hour. */
const DEFAULT_HOUR = 9;

/**
 * In India people often write times with a DOT: "11.30", "at 6.45 pm". chrono only knows
 * "11:30", so we turn "H.MM" into "H:MM" first. Not for dates like "20.11.2026" (another dot follows).
 */
function dotTimesToColon(text: string): string {
  return text.replace(/(^|[^\d.])(\d{1,2})\.(\d{2})(?![\d.])/g, (all, before: string, h: string, m: string) =>
    Number(h) <= 23 && Number(m) <= 59 ? `${before}${h}:${m}` : all,
  );
}

export function parseWhen(text: string, now = new Date()): ParsedWhen | null {
  const [result] = chrono.en.GB.parse(dotTimesToColon(text), now, { forwardDate: true });
  if (!result) return null;
  const date = result.start.date();
  if (!result.start.isCertain("hour")) {
    date.setHours(DEFAULT_HOUR, 0, 0, 0);
  } else if (!result.start.isCertain("meridiem") && date.getHours() >= 1 && date.getHours() <= 7) {
    // "at 5" with no am/pm → people mean 5 PM, not 5 in the morning
    date.setHours(date.getHours() + 12);
    // chrono may have already moved "5 am" to tomorrow; 5 PM today might still be ahead → use today
    const dayEarlier = new Date(date.getTime() - 86_400_000);
    if (!result.start.isCertain("day") && dayEarlier > now) date.setTime(dayEarlier.getTime());
  }
  // A time in the past (e.g. "today" at 9 am when it's evening) is returned as-is;
  // the caller refuses it with a clear message instead of silently guessing another day.
  return { date, matched: result.text };
}

/** For humans: "Fri 13 Nov, 6:00 pm" (today/tomorrow get a friendly word). */
export function formatWhen(d: Date, now = new Date()): string {
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  if (dayDiff === 0) return `today ${time}`;
  if (dayDiff === 1) return `tomorrow ${time}`;
  const day = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${time}`;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** SQLite UTC text → Date. */
export const fromSqlTime = (s: string) => new Date(s.replace(" ", "T") + "Z");
