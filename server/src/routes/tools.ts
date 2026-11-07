/**
 *   GET /api/tools        → what JARVIS is allowed to do
 *   GET /api/tools/logs   → what JARVIS actually did (audit log, newest first)
 */
import { Router } from "express";
import { listTools } from "../tools/registry.js";
import { listToolLogs } from "../database/toolLogs.js";

export const toolsRouter = Router();

toolsRouter.get("/", (_req, res) => {
  res.json(listTools());
});

toolsRouter.get("/logs", (_req, res) => {
  res.json(listToolLogs().map((l) => ({ ...l, args: JSON.parse(l.args), ok: l.ok === 1 })));
});
