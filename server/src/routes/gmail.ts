/**
 *   GET  /api/gmail/status       → { configured, connected, email }
 *   GET  /api/gmail/connect      → redirects the browser to Google's login page
 *   GET  /api/gmail/callback     → Google sends the user back here with ?code=&state=
 *   POST /api/gmail/disconnect   → cancel access + delete tokens
 *   GET  /api/gmail/messages?q=&max=  → list emails (for the UI)
 *
 * 📘 LESSON: Redirects (HTTP 302)
 * res.redirect(url) tells the browser "go to this other address". OAuth is built on
 * redirects: our app → Google → back to our app.
 */
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import {
  buildAuthUrl,
  disconnect,
  gmailStatus,
  GoogleAuthError,
  handleCallback,
} from "../integrations/google/oauth.js";
import { readEmail, searchEmails } from "../integrations/google/gmail.js";

export const gmailRouter = Router();

/** Send the user back to the React app with a message in the URL. */
const backToApp = (params: Record<string, string>) =>
  `${config.clientOrigin}/?${new URLSearchParams(params)}`;

gmailRouter.get("/status", (_req, res) => {
  res.json(gmailStatus());
});

gmailRouter.get("/connect", (_req, res) => {
  try {
    res.redirect(buildAuthUrl());
  } catch (err) {
    res.redirect(backToApp({ gmail: "error", message: (err as Error).message }));
  }
});

gmailRouter.get("/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (typeof error === "string") {
    // e.g. the user clicked "Cancel" on Google's page
    res.redirect(backToApp({ gmail: "error", message: `Google said: ${error}` }));
    return;
  }
  if (typeof code !== "string" || typeof state !== "string") {
    res.status(400).send("Missing code or state");
    return;
  }
  try {
    const email = await handleCallback(code, state);
    console.log(`📧 Gmail connected: ${email}`);
    res.redirect(backToApp({ gmail: "connected", email }));
  } catch (err) {
    console.error("Gmail connect failed:", err);
    const message = err instanceof GoogleAuthError ? err.message : "Connection failed (see server log)";
    res.redirect(backToApp({ gmail: "error", message }));
  }
});

gmailRouter.post("/disconnect", async (_req, res) => {
  await disconnect();
  res.status(204).end();
});

const listSchema = z.object({
  q: z.string().max(200).default("in:inbox"),
  max: z.coerce.number().int().min(1).max(25).default(10),
});

gmailRouter.get("/messages", async (req, res, next) => {
  const query = listSchema.safeParse(req.query);
  if (!query.success) return void res.status(400).json({ error: "Invalid query" });
  if (!gmailStatus().connected) return void res.status(409).json({ error: "Gmail is not connected" });
  try {
    res.json(await searchEmails(query.data.q, query.data.max));
  } catch (err) {
    if (err instanceof GoogleAuthError) return void res.status(401).json({ error: err.message });
    next(err);
  }
});

// GET /api/gmail/messages/:id → one full email (for the Email page reader)
gmailRouter.get("/messages/:id", async (req, res, next) => {
  const id = z.string().regex(/^[a-zA-Z0-9]+$/).max(64).safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid id" });
  if (!gmailStatus().connected) return void res.status(409).json({ error: "Gmail is not connected" });
  try {
    res.json(await readEmail(id.data));
  } catch (err) {
    if (err instanceof GoogleAuthError) return void res.status(401).json({ error: err.message });
    next(err);
  }
});
