/**
 * 📘 LESSON: REST API design
 * REST = a common style: one URL per "resource", and the HTTP METHOD says the action.
 *
 *   GET    /api/conversations        → list all          (200)
 *   GET    /api/conversations/:id    → one + messages    (200 / 404)
 *   PATCH  /api/conversations/:id    → rename            (200 / 404)
 *   DELETE /api/conversations/:id    → delete            (204 / 404)
 *
 * (New conversations are created automatically by POST /api/chat.)
 * 204 = "No Content": success, but nothing to send back.
 */
import { Router } from "express";
import { z } from "zod";
import { idParam } from "./params.js";
import {
  deleteConversation,
  getConversation,
  listConversations,
  listMessages,
  renameConversation,
} from "../database/conversations.js";

export const conversationsRouter = Router();

conversationsRouter.get("/", (_req, res) => {
  res.json(listConversations());
});

conversationsRouter.get("/:id", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid id" });

  const conversation = getConversation(id.data);
  if (!conversation) return void res.status(404).json({ error: "Conversation not found" });

  res.json({ ...conversation, messages: listMessages(id.data) });
});

const renameSchema = z.object({ title: z.string().trim().min(1).max(100) });

conversationsRouter.patch("/:id", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = renameSchema.safeParse(req.body);
  if (!id.success || !body.success) return void res.status(400).json({ error: "Invalid request" });

  const updated = renameConversation(id.data, body.data.title);
  if (!updated) return void res.status(404).json({ error: "Conversation not found" });
  res.json(updated);
});

conversationsRouter.delete("/:id", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid id" });

  if (!deleteConversation(id.data)) {
    return void res.status(404).json({ error: "Conversation not found" });
  }
  res.status(204).end();
});
