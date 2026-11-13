/**
 * Chat tools for to-dos and reminders. They only call services/tasks.ts (the same rules
 * the Tasks page uses), so the chat and the page can never behave differently.
 *
 * Note the `when` argument: the AI must COPY the user's words ("in 10 minutes"), never
 * calculate a clock time itself. Our code does the date maths (services/timeParse.ts).
 */
import { z } from "zod";
import { defineTool } from "./types.js";
import { listTasks, type Task } from "../database/tasks.js";
import { completeTask, createTask, editTask, findOneOpenTask, removeTask } from "../services/tasks.js";
import { formatWhen, fromSqlTime } from "../services/timeParse.js";

const describe = (t: Task) =>
  `[task:${t.id}] ${t.text}` +
  (t.due_at ? ` (reminder: ${formatWhen(fromSqlTime(t.due_at))}${t.notified_at && !t.done ? ", already rang" : ""})` : "") +
  (t.done ? " ✓ done" : "");

const WHEN_HELP =
  "The time in the USER'S OWN WORDS, copied exactly, e.g. \"in 10 minutes\", \"at 6 pm\", \"tomorrow 9am\", \"friday 5pm\". " +
  "Do NOT convert it to a clock time yourself.";

// The AI can point at a task by number OR by some words from it ("mark buy milk as done").
const taskRef = {
  id: z.coerce.number().int().positive().optional().describe("Task number, if known (from [task:N])"),
  match: z.string().trim().max(100).optional().describe("Some words from the task text, if the number is unknown"),
};

export const taskAdd = defineTool({
  name: "task_add",
  description:
    "Add a to-do item, or a REMINDER when the user gives a time (\"remind me to call mom at 6 pm\"). " +
    "Leave 'when' out for a plain to-do (\"add buy milk to my list\").",
  permission: "action",
  schema: z.object({
    text: z.string().trim().min(1).max(300).describe("What to do, short, e.g. \"Call mom\""),
    when: z.string().trim().max(100).optional().describe(WHEN_HELP),
  }),
  run: async ({ text, when }) => {
    const t = createTask(text, when);
    return t.due_at
      ? `Reminder set: "${t.text}" at ${formatWhen(fromSqlTime(t.due_at))} [task:${t.id}]. JARVIS will pop up a Windows notification and speak it.`
      : `Added to the to-do list: "${t.text}" [task:${t.id}].`;
  },
});

export const tasksList = defineTool({
  name: "tasks_list",
  description: "Show the user's to-do list and upcoming reminders.",
  permission: "read",
  schema: z.object({
    show: z.enum(["open", "done", "all"]).optional().describe("open (default) = not done yet"),
  }),
  run: async ({ show }) => {
    const tasks = listTasks(show ?? "open");
    if (tasks.length === 0) return show === "done" ? "No completed tasks." : "The to-do list is empty.";
    return `${tasks.length} task(s):\n${tasks.map(describe).join("\n")}`;
  },
});

export const taskComplete = defineTool({
  name: "task_complete",
  description: "Mark a to-do or reminder as done (\"I bought the milk\", \"mark task 3 as done\").",
  permission: "action",
  schema: z.object(taskRef),
  run: async (ref) => {
    const t = completeTask(findOneOpenTask(ref).id);
    return `Done ✓ "${t.text}" [task:${t.id}].`;
  },
});

export const taskUpdate = defineTool({
  name: "task_update",
  description: "Change a task's text or move a reminder to a new time (\"move my call mom reminder to 7 pm\").",
  permission: "action",
  schema: z.object({
    ...taskRef,
    text: z.string().trim().min(1).max(300).optional().describe("New text, only if the user changes it"),
    when: z.string().trim().max(100).optional().describe(`New time. ${WHEN_HELP}`),
  }),
  run: async ({ text, when, ...ref }) => {
    const t = editTask(findOneOpenTask(ref).id, { text, when });
    return `Updated: ${describe(t)}`;
  },
});

export const taskDelete = defineTool({
  name: "task_delete",
  description: "Delete a to-do or cancel a reminder completely.",
  permission: "action",
  schema: z.object(taskRef),
  run: async (ref) => {
    const t = findOneOpenTask(ref);
    removeTask(t.id);
    return `Deleted "${t.text}" [task:${t.id}].`;
  },
});
