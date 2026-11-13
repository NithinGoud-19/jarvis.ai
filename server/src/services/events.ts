/**
 * 📘 LESSON: Pushing from the server to the browser (Server-Sent Events)
 * Normally the browser ASKS and the server ANSWERS. But a reminder happens at 6 pm
 * whether the browser asked or not. Options:
 *   - Polling:   the browser asks "anything new?" every few seconds → wasteful, and late.
 *   - WebSocket: two-way live connection → powerful, but more code than we need.
 *   - SSE:       the browser opens ONE long request (GET /api/events) and the server keeps it
 *                open, writing a message whenever something happens. One-way, built into
 *                every browser (EventSource), and it reconnects by itself. ✅ Perfect here.
 *
 * This file is a tiny "hub": it remembers every open browser tab and sends events to all of them.
 */
import type { Response } from "express";

export type ServerEvent =
  | { type: "reminder"; task: { id: number; text: string; due_at: string | null }; missed: boolean }
  | { type: "tasks-changed" };

const clients = new Set<Response>();

export function addClient(res: Response): void {
  clients.add(res);
  res.on("close", () => clients.delete(res));
}

export function broadcast(event: ServerEvent): void {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(line);
}

export const clientCount = () => clients.size;

// 📘 Some proxies close a connection that has been silent for a while. A "comment" line
// (starts with ":") every 25 s keeps it alive; EventSource ignores comments.
setInterval(() => {
  for (const res of clients) res.write(": ping\n\n");
}, 25_000).unref(); // unref = this timer alone doesn't keep Node running
