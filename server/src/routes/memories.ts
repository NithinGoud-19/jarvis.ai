/**
 *   GET    /api/memories       → list
 *   POST   /api/memories       → add     body: { content: "..." }   (201 Created)
 *   DELETE /api/memories/:id   → delete  (204 / 404)
 */
import { Router } from "express";
import { z } from "zod";
import { idParam } from "./params.js";
import { addMemory, deleteMemory, listMemories } from "../database/memories.js";

export const memoriesRouter = Router();

memoriesRouter.get("/", (_req, res) => {
  res.json(listMemories());
});

const memorySchema = z.object({ content: z.string().trim().min(1).max(500) });

memoriesRouter.post("/", (req, res) => {
  const body = memorySchema.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid request" });
  // 201 = "Created": the standard status when a POST makes something new
  res.status(201).json(addMemory(body.data.content));
});

memoriesRouter.delete("/:id", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid id" });
  if (!deleteMemory(id.data)) return void res.status(404).json({ error: "Memory not found" });
  res.status(204).end();
});
