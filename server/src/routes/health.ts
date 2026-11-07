/**
 * 📘 LESSON: Routes
 * A route = HTTP method + URL path + handler function.
 * GET /api/health → "Is the server OK? Is Ollama OK?"
 * Health routes are standard in real backends; monitoring tools call them.
 */
import { Router } from "express";
import { checkOllama } from "../services/ollama.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const ollama = await checkOllama();
  res.json({
    server: "ok",
    ...ollama,
    time: new Date().toISOString(),
  });
});
