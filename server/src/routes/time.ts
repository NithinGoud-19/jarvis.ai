import { Router } from "express";

export const timeRouter = Router();

timeRouter.get("/", (_req, res) => {
  res.json({ day:new Date().toLocaleDateString("en-IN", { weekday: "long" }),  
  time : new Date().toLocaleString() });
});
