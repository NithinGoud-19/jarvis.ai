/**
 * GET /api/events → a Server-Sent Events stream that stays open (see services/events.ts).
 * The browser opens it once with `new EventSource("/api/events")`.
 */
import { Router } from "express";
import { addClient } from "../services/events.js";

export const eventsRouter = Router();

eventsRouter.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(": connected\n\n");
  addClient(res); // the hub writes events here until the tab closes
});
