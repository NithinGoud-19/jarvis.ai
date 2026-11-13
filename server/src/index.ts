/**
 * 📘 LESSON: The entry point
 * This file creates the Express "app", plugs in middleware and routes, and starts
 * listening on a port. Request flow:
 *
 *   request → cors → json parser → logger → router (/api/...) → notFound → errorHandler
 */
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { chatRouter } from "./routes/chat.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { timeRouter } from "./routes/time.js";
import { conversationsRouter } from "./routes/conversations.js";
import { memoriesRouter } from "./routes/memories.js";
import { statusRouter } from "./routes/status.js";
import { toolsRouter } from "./routes/tools.js";
import { voiceRouter } from "./routes/voice.js";
import { gmailRouter } from "./routes/gmail.js";
import { systemRouter } from "./routes/system.js";
import { jobsRouter } from "./routes/jobs.js";
import { tasksRouter } from "./routes/tasks.js";
import { eventsRouter } from "./routes/events.js";
import { briefingRouter } from "./routes/briefing.js";
import { startReminderScheduler } from "./services/reminders.js";

const app = express();

// CORS: browsers block calls to a different origin (port) unless the server allows it.
app.use(cors({ origin: config.clientOrigin }));

// Parse JSON request bodies into req.body (limit size to stop abuse).
app.use(express.json({ limit: "1mb" }));

// Tiny request logger (our own middleware!)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start} ms)`);
  });
  next();
});

app.use("/api/health", healthRouter);
app.use("/api/chat", chatRouter);
app.use("/api/time", timeRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/memories", memoriesRouter);
app.use("/api/stats", statusRouter);
app.use("/api/tools", toolsRouter);
app.use("/api/voice", voiceRouter);
app.use("/api/gmail", gmailRouter);
app.use("/api/system", systemRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/events", eventsRouter);
app.use("/api/briefing", briefingRouter);

app.use(notFound);
app.use(errorHandler);

// Bind to localhost only: JARVIS will control your PC, so it must NOT be reachable from your Wi-Fi.
app.listen(config.port, "127.0.0.1", () => {
  console.log(`🤖 JARVIS server running at http://localhost:${config.port}`);
  console.log(`   Model: ${config.ollamaModel} via ${config.ollamaUrl}`);
  startReminderScheduler(); // 📘 background job: starts once the server is ready
});
