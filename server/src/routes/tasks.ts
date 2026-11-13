/**
 *   GET    /api/tasks?show=open|done|all  → list
 *   POST   /api/tasks                     → add      body: { text, when? }   (201)
 *   PATCH  /api/tasks/:id                 → change   body: { text?, when?, done? }
 *   POST   /api/tasks/:id/snooze          → remind again later  body: { minutes }
 *   DELETE /api/tasks/:id                 → delete   (204)
 *   GET    /api/tasks/ringing             → reminders that rang and still need your attention
 *   POST   /api/tasks/:id/dismiss         → close a ringing reminder's banner (204)
 *
 * 📘 LESSON: PATCH vs PUT
 * PUT = "replace the whole thing". PATCH = "change only the fields I send".
 * Ticking a checkbox sends just { done: true }, so PATCH is the right verb.
 *
 * 📘 Express 5 catches errors thrown inside a route and passes them to errorHandler,
 * so the TaskError messages ("that time is in the past") reach the browser without try/catch here.
 */
import { Router } from "express";
import { z } from "zod";
import { idParam } from "./params.js";
import { listRinging, listTasks } from "../database/tasks.js";
import { completeTask, createTask, dismissReminder, editTask, removeTask, snoozeTask } from "../services/tasks.js";

export const tasksRouter = Router();

const showSchema = z.enum(["open", "done", "all"]).catch("open");

tasksRouter.get("/", (req, res) => {
  res.json(listTasks(showSchema.parse(req.query.show)));
});

// 📘 Route ORDER matters: "/ringing" must be defined before any "/:id" GET, or Express would
// treat the word "ringing" as an id. (We have no GET "/:id", but it's a good habit.)
tasksRouter.get("/ringing", (_req, res) => {
  res.json(listRinging());
});

tasksRouter.post("/:id/dismiss", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid id" });
  dismissReminder(id.data);
  res.status(204).end();
});

const text = z.string().trim().min(1).max(300);
const when = z.string().trim().max(100).nullable();

tasksRouter.post("/", (req, res) => {
  const body = z.object({ text, when: when.optional() }).safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Write what the task is (max 300 characters)." });
  res.status(201).json(createTask(body.data.text, body.data.when));
});

tasksRouter.patch("/:id", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = z.object({ text: text.optional(), when: when.optional(), done: z.boolean().optional() }).safeParse(req.body);
  if (!id.success || !body.success) return void res.status(400).json({ error: "Invalid request" });

  const { done, ...changes } = body.data;
  let task = changes.text !== undefined || changes.when !== undefined ? editTask(id.data, changes) : undefined;
  if (done !== undefined) task = completeTask(id.data, done);
  if (!task) return void res.status(400).json({ error: "Nothing to change" });
  res.json(task);
});

tasksRouter.post("/:id/snooze", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = z.object({ minutes: z.number().int().min(1).max(24 * 60) }).safeParse(req.body);
  if (!id.success || !body.success) return void res.status(400).json({ error: "Invalid request" });
  res.json(snoozeTask(id.data, body.data.minutes));
});

tasksRouter.delete("/:id", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid id" });
  removeTask(id.data);
  res.status(204).end();
});
