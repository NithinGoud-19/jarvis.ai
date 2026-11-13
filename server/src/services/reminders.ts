/**
 * 📘 LESSON: Background jobs (a "scheduler")
 * Most backend code runs because a request arrived. A scheduler runs because TIME passed.
 * Ours is the simplest kind: setInterval checks the database every 15 seconds,
 * "are any reminders due?". (Bigger apps use cron libraries or job queues, same idea.)
 *
 * Why check the DATABASE instead of setTimeout(fire, msUntil6pm) for each reminder?
 *   - Timers live in memory → a server restart would forget them all.
 *   - The database survives restarts → reminders that came due while JARVIS was OFF
 *     are found on the first check after start-up ("missed reminders").
 */
import { takeDueReminders } from "../database/tasks.js";
import { broadcast } from "./events.js";
import { showWindowsNotification } from "./notify.js";
import { formatWhen, fromSqlTime } from "./timeParse.js";

const CHECK_EVERY_MS = 15_000;
/** Fired more than this late → we call it "missed" (JARVIS was off / laptop asleep). */
const MISSED_AFTER_MS = 2 * 60_000;

let timer: NodeJS.Timeout | null = null;

export function checkReminders(): number {
  const due = takeDueReminders();
  for (const task of due) {
    const dueAt = task.due_at ? fromSqlTime(task.due_at) : new Date();
    const missed = Date.now() - dueAt.getTime() > MISSED_AFTER_MS;
    console.log(`⏰ Reminder #${task.id}: ${task.text}${missed ? " (missed)" : ""}`);

    // 1. Live message to every open JARVIS tab (banner + spoken out loud)
    broadcast({ type: "reminder", task: { id: task.id, text: task.text, due_at: task.due_at }, missed });
    // 2. Windows pop-up, so you see it even when the browser is minimised.
    //    Not awaited: a slow PowerShell must not delay other reminders. Failure is only logged.
    const title = missed ? `⏰ Missed reminder (${formatWhen(dueAt)})` : "⏰ JARVIS reminder";
    showWindowsNotification(title, task.text).catch((err) =>
      console.warn(`⚠️  Windows notification failed: ${err instanceof Error ? err.message : err}`),
    );
  }
  if (due.length) broadcast({ type: "tasks-changed" });
  return due.length;
}

export function startReminderScheduler(): void {
  if (timer) return;
  checkReminders(); // right away: catches reminders missed while the server was off
  timer = setInterval(checkReminders, CHECK_EVERY_MS);
  console.log("⏰ Reminder scheduler running (checks every 15 s)");
}
