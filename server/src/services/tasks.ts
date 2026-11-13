/**
 * Task rules shared by the REST API (Tasks page) AND the AI tools (chat).
 *
 * 📘 LESSON: The "service layer"
 *   route / tool  →  service (rules: "time must be in the future")  →  repository (SQL)
 * If the rule lived inside the route, the chat tool would need a copy of it, and one day
 * the two copies would disagree. One service = one place for the rules.
 *
 * Errors are thrown as TaskError with a message written for HUMANS, because it is
 * shown as-is on the Tasks page and read out by JARVIS in the chat.
 */
import { addTask, deleteTask, dismissTask, findOpenTasks, getTask, setTaskDone, updateTask, type Task } from "../database/tasks.js";
import { broadcast } from "./events.js";
import { parseWhen } from "./timeParse.js";

/** errorHandler (middleware) sends `status` + the message to the browser. 400 = your input was wrong, 404 = not found. */
export class TaskError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** "in 10 minutes" → a future Date. Empty → null (a plain to-do). */
export function resolveWhen(when: string | undefined | null, now = new Date()): Date | null {
  if (!when?.trim()) return null;
  const parsed = parseWhen(when, now);
  if (!parsed) {
    throw new TaskError(`I couldn't understand the time "${when}". Try "in 20 minutes", "at 6 pm" or "tomorrow 9am".`);
  }
  if (parsed.date.getTime() <= now.getTime()) {
    throw new TaskError(`"${when}" is already in the past. Please give a future time.`);
  }
  return parsed.date;
}

export function createTask(text: string, when?: string | null): Task {
  const task = addTask(text.trim(), resolveWhen(when));
  broadcast({ type: "tasks-changed" }); // other open tabs refresh their list
  return task;
}

export function editTask(id: number, changes: { text?: string; when?: string | null }): Task {
  requireTask(id);
  const task = updateTask(id, {
    text: changes.text?.trim(),
    // when: undefined = don't touch the time, "" or null = remove the time
    due: changes.when === undefined ? undefined : resolveWhen(changes.when),
  })!;
  broadcast({ type: "tasks-changed" });
  return task;
}

export function snoozeTask(id: number, minutes: number): Task {
  requireTask(id);
  const task = updateTask(id, { due: new Date(Date.now() + minutes * 60_000) })!;
  broadcast({ type: "tasks-changed" });
  return task;
}

export function completeTask(id: number, done = true): Task {
  requireTask(id);
  const task = setTaskDone(id, done)!;
  broadcast({ type: "tasks-changed" });
  return task;
}

/** Close a ringing reminder's banner (the task itself stays). */
export function dismissReminder(id: number): void {
  if (!dismissTask(id)) throw new TaskError(`There is no task #${id}.`, 404);
  broadcast({ type: "tasks-changed" });
}

export function removeTask(id: number): void {
  if (!deleteTask(id)) throw new TaskError(`There is no task #${id}.`, 404);
  broadcast({ type: "tasks-changed" });
}

/**
 * For the chat: find ONE open task by its id or by words in its text.
 * "mark buy milk as done" → match "buy milk". Several matches → ask the user which one.
 */
export function findOneOpenTask(ref: { id?: number; match?: string }): Task {
  if (ref.id !== undefined) return requireTask(ref.id);
  const search = ref.match?.trim();
  if (!search) throw new TaskError("Say which task (its number or some words from it).");
  const found = findOpenTasks(search);
  if (found.length === 0) throw new TaskError(`No open task contains "${search}".`);
  if (found.length > 1) {
    throw new TaskError(
      `Several open tasks contain "${search}": ${found.map((t) => `#${t.id} "${t.text}"`).join(", ")}. Ask the user which one.`,
    );
  }
  return found[0];
}

function requireTask(id: number): Task {
  const task = getTask(id);
  if (!task) throw new TaskError(`There is no task #${id}.`, 404);
  return task;
}
