/**
 * The morning briefing: weather + today's reminders + to-dos + unread email + battery,
 * turned into a few sentences JARVIS reads out loud.
 *
 * 📘 LESSON: Aggregation ("backend for frontend")
 * One endpoint collects data from FIVE different places and returns one tidy answer.
 * The browser makes one request instead of five, and the logic lives on the server.
 *
 * 📘 LESSON: Promise.allSettled for partial failure
 * All five sources are asked AT THE SAME TIME. If one fails (Gmail login expired, no internet
 * for the weather), the briefing still works and simply skips that part.
 *
 * 📘 Design choice: the sentences are built by CODE, not by the AI.
 * On this laptop the AI needs 20–60 s and could invent an email or a wrong number.
 * A template is instant and always exactly true. Use AI where language understanding is needed,
 * not where a simple template does the job.
 */
import { getSetting, setSetting } from "../database/settings.js";
import { listTasks, listRinging, type Task } from "../database/tasks.js";
import { gmailStatus } from "../integrations/google/oauth.js";
import { searchEmails } from "../integrations/google/gmail.js";
import { findPlace, getWeather, type Place, type Weather } from "../integrations/weather.js";
import { getBattery } from "../tools/system.js";
import { fromSqlTime } from "./timeParse.js";

const MAX_EMAILS = 10;

export type Briefing = {
  generatedAt: string;
  greeting: string;
  weather: Weather | null;
  remindersToday: { id: number; text: string; time: string }[];
  waiting: { id: number; text: string }[]; // reminders that already rang and are not done
  todoCount: number;
  email: { connected: boolean; unread: number; more: boolean; important: { from: string; subject: string }[] } | null;
  battery: { percent: number; charging: boolean } | null;
  problems: string[]; // parts that could not be loaded, e.g. "weather: no internet"
  speech: string; // what JARVIS says
  shouldAutoPlay: boolean;
};

// ---------- helpers ----------

/** Local calendar date "2026-11-13" ("en-CA" happens to format dates exactly like that). */
export const localDate = (d = new Date()) => d.toLocaleDateString("en-CA");

/** Speech-friendly time: "6 PM", "11:30 AM" (no ":00" for Piper to read out). */
function sayTime(d: Date): string {
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return `${h}${m ? `:${String(m).padStart(2, "0")}` : ""} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

/** ["a", "b", "c"] → "a, b, and c" */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function greetingFor(hour: number): string {
  if (hour < 5) return "Working late, Sir";
  if (hour < 12) return "Good morning, Sir";
  if (hour < 17) return "Good afternoon, Sir";
  return "Good evening, Sir";
}

/** "Rahul Sharma <rahul@x.com>" → "Rahul Sharma" */
const senderName = (from: string) => from.replace(/<.*>/, "").replace(/"/g, "").trim() || from;

export async function savedPlace(): Promise<Place> {
  const saved = getSetting("weather_place");
  if (saved) return JSON.parse(saved) as Place;
  // First run: look up the default city once and remember it
  const place = await findPlace(getSetting("weather_city"));
  if (!place) throw new Error(`city "${getSetting("weather_city")}" not found`);
  setSetting("weather_place", JSON.stringify(place));
  return place;
}

// ---------- the five sources ----------

async function loadEmail(): Promise<Briefing["email"]> {
  if (!gmailStatus().connected) return { connected: false, unread: 0, more: false, important: [] };
  const unread = await searchEmails("is:unread in:inbox", MAX_EMAILS);
  return {
    connected: true,
    unread: unread.length,
    more: unread.length === MAX_EMAILS,
    important: unread
      .filter((e) => e.important)
      .slice(0, 3)
      .map((e) => ({ from: senderName(e.from), subject: e.subject.length > 70 ? `${e.subject.slice(0, 70)}…` : e.subject })),
  };
}

async function loadBattery(): Promise<Briefing["battery"]> {
  const b = JSON.parse(await getBattery.run({})) as { percent?: number; status?: string; error?: string };
  if (b.percent === undefined) return null; // desktop PC
  return { percent: b.percent, charging: /charg|plugged/.test(b.status ?? "") && !/discharg/.test(b.status ?? "") };
}

function loadTasks(now: Date) {
  const today = localDate(now);
  const open = listTasks("open");
  const remindersToday = open
    .filter((t): t is Task & { due_at: string } => Boolean(t.due_at) && !t.notified_at)
    .map((t) => ({ t, due: fromSqlTime(t.due_at) }))
    .filter(({ due }) => localDate(due) === today && due > now)
    .map(({ t, due }) => ({ id: t.id, text: t.text, time: sayTime(due) }));
  const waiting = listRinging().map((t) => ({ id: t.id, text: t.text }));
  const todoCount = open.filter((t) => !t.due_at).length;
  return { remindersToday, waiting, todoCount };
}

// ---------- putting it together ----------

function buildSpeech(b: Omit<Briefing, "speech" | "shouldAutoPlay">, now: Date): string {
  const s: string[] = [];
  const day = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  s.push(`${b.greeting}. It's ${day}.`);

  if (b.weather) {
    const w = b.weather;
    s.push(`In ${w.place.split(",")[0]} it's ${w.temperature} degrees and ${w.sky}, with a high of ${w.high} and a low of ${w.low}.`);
    if (w.rainChance >= 50) s.push(`There's a ${w.rainChance} percent chance of rain, so take an umbrella.`);
    else if (w.high >= 38) s.push("It's going to be very hot, so drink plenty of water.");
  }

  const r = b.remindersToday;
  if (r.length === 0) s.push("You have no more reminders today.");
  else {
    const shown = r.slice(0, 4).map((x) => `${x.text} at ${x.time}`);
    if (r.length > 4) shown.push(`${r.length - 4} more`);
    s.push(`You have ${r.length === 1 ? "one reminder" : `${r.length} reminders`} today: ${joinList(shown)}.`);
  }
  if (b.waiting.length) {
    s.push(`${b.waiting.length === 1 ? "One reminder is" : `${b.waiting.length} reminders are`} still waiting from earlier: ${joinList(b.waiting.slice(0, 3).map((x) => x.text))}.`);
  }
  if (b.todoCount) s.push(`Your to-do list has ${b.todoCount} ${b.todoCount === 1 ? "item" : "items"}.`);

  if (b.email?.connected) {
    const e = b.email;
    if (e.unread === 0) s.push("Your inbox is clear.");
    else {
      s.push(`You have ${e.more ? `${e.unread} or more` : e.unread} unread ${e.unread === 1 ? "email" : "emails"}.`);
      if (e.important.length) {
        const list = e.important.map((x) => `from ${x.from} about ${x.subject}`);
        s.push(`${e.important.length === 1 ? "One looks" : `${e.important.length} look`} important: ${joinList(list)}.`);
      }
    }
  }

  if (b.battery && !b.battery.charging && b.battery.percent < 30) {
    s.push(`Battery is at ${b.battery.percent} percent. You may want to plug in.`);
  } else if (b.battery) {
    s.push(`Battery is at ${b.battery.percent} percent${b.battery.charging ? " and charging" : ""}.`);
  }

  s.push(now.getHours() < 17 ? "Have a productive day." : "That's everything for now.");
  return s.join(" ");
}

function shouldAutoPlay(now: Date): boolean {
  const hour = now.getHours();
  return (
    getSetting("briefing_autoplay") === "1" &&
    hour >= 5 &&
    hour < 12 && // "morning" briefing
    getSetting("briefing_last_autoplay") !== localDate(now)
  );
}

export function markAutoPlayed(now = new Date()): void {
  setSetting("briefing_last_autoplay", localDate(now));
}

export async function buildBriefing(now = new Date()): Promise<Briefing> {
  const [weather, email, battery] = await Promise.allSettled([
    savedPlace().then(getWeather),
    loadEmail(),
    loadBattery(),
  ]);
  const problems: string[] = [];
  const value = <T>(r: PromiseSettledResult<T>, label: string): T | null => {
    if (r.status === "fulfilled") return r.value;
    problems.push(`${label}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    return null;
  };

  const base = {
    generatedAt: now.toISOString(),
    greeting: greetingFor(now.getHours()),
    weather: value(weather, "weather"),
    ...loadTasks(now), // from our own database: instant, can't fail like a network call
    email: value(email, "email"),
    battery: value(battery, "battery"),
    problems,
  };
  return { ...base, speech: buildSpeech(base, now), shouldAutoPlay: shouldAutoPlay(now) };
}
