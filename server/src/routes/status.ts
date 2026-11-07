import { Router } from "express";
import { db } from "../database/db.js";

export const statusRouter = Router();

statusRouter.get("/", (_req, res) => {
  const conversations = db.prepare("SELECT COUNT(*) AS n FROM conversations").get() as { n: number };
  const messages = db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
  const memories = db.prepare("SELECT COUNT(*) AS n FROM memories").get() as { n: number };

  res.json({
    conversations: conversations.n,
    messages: messages.n,
    memories: memories.n,
  });
});
