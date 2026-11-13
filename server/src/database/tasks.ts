/**
 * Repository for the tasks table (to-dos + reminders). All task SQL lives here.
 *
 * 📘 LESSON: Storing time
 * Times are saved in UTC ("2026-11-13 12:30:00"), the same format SQLite's datetime('now')
 * uses. Why not local time? Because then comparing "is it due yet?" is one simple SQL
 * condition, and nothing breaks if the clock changes timezone. We convert to India time
 * only when SHOWING a time to a human (see formatWhen in services/timeParse.ts).
 */
import { db } from "./db.js";

export type Task = {
  id: number;
  text: string;
  due_at: string | null; // UTC "YYYY-MM-DD HH:MM:SS"
  done: boolean;
  notified_at: string | null;
  created_at: string;
  completed_at: string | null;
};

type TaskRow = Omit<Task, "done"> & { done: 0 | 1 };
const toTask = (r: TaskRow): Task => ({ ...r, done: r.done === 1 });

/** JavaScript Date → SQLite UTC text. toISOString() is "2026-11-13T12:30:00.000Z" → cut it into shape. */
export function toSqlTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function getTask(id: number): Task | undefined {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  return row && toTask(row);
}

export function addTask(text: string, due: Date | null): Task {
  const row = db
    .prepare("INSERT INTO tasks (text, due_at) VALUES (?, ?) RETURNING *")
    .get(text, due ? toSqlTime(due) : null) as TaskRow;
  return toTask(row);
}

export type TaskFilter = "open" | "done" | "all";

/**
 * Open tasks: reminders first (soonest first), then plain to-dos (oldest first).
 * 📘 "due_at IS NULL" is 0 for reminders and 1 for to-dos → sorting by it puts reminders on top.
 */
export function listTasks(show: TaskFilter = "open"): Task[] {
  const where = show === "open" ? "WHERE done = 0" : show === "done" ? "WHERE done = 1" : "";
  const order = show === "done" ? "completed_at DESC" : "done, due_at IS NULL, due_at, id";
  return (db.prepare(`SELECT * FROM tasks ${where} ORDER BY ${order} LIMIT 300`).all() as TaskRow[]).map(toTask);
}

/** Open tasks whose text contains the words (for "mark buy milk as done"). */
export function findOpenTasks(search: string): Task[] {
  return (db.prepare("SELECT * FROM tasks WHERE done = 0 AND text LIKE ? ORDER BY id").all(`%${search}%`) as TaskRow[]).map(
    toTask,
  );
}

export function setTaskDone(id: number, done: boolean): Task | undefined {
  db.prepare(
    `UPDATE tasks SET done = ?, completed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ?`,
  ).run(done ? 1 : 0, done ? 1 : 0, id);
  return getTask(id);
}

/** New text and/or new time. A new time also "re-arms" the reminder (notified_at = NULL). */
export function updateTask(id: number, changes: { text?: string; due?: Date | null }): Task | undefined {
  if (changes.text !== undefined) db.prepare("UPDATE tasks SET text = ? WHERE id = ?").run(changes.text, id);
  if (changes.due !== undefined) {
    db.prepare("UPDATE tasks SET due_at = ?, notified_at = NULL WHERE id = ?").run(
      changes.due ? toSqlTime(changes.due) : null,
      id,
    );
  }
  return getTask(id);
}

export function deleteTask(id: number): boolean {
  return db.prepare("DELETE FROM tasks WHERE id = ?").run(id).changes > 0;
}

/**
 * Reminders that are due now and haven't fired yet. They are marked as fired IN THE SAME
 * TRANSACTION, so even if two timers ran at once, each reminder is handed out only once.
 */
export const takeDueReminders = db.transaction((): Task[] => {
  const rows = db
    .prepare(
      `SELECT * FROM tasks
       WHERE done = 0 AND due_at IS NOT NULL AND notified_at IS NULL AND due_at <= datetime('now')
       ORDER BY due_at`,
    )
    .all() as TaskRow[];
  const mark = db.prepare("UPDATE tasks SET notified_at = datetime('now') WHERE id = ?");
  for (const r of rows) mark.run(r.id);
  return rows.map(toTask);
});
