/** GET /api/system → live CPU, RAM, battery, uptime (for the dashboard). */
import { Router } from "express";
import { systemStats } from "../services/system.js";

export const systemRouter = Router();

systemRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await systemStats());
  } catch (err) {
    next(err);
  }
});
