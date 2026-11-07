/**
 * Repository for the tool_logs table: an "audit log" of everything JARVIS did.
 * 📘 Real systems keep audit logs so you can always answer: "What did it do, and when?"
 */
import { db } from "./db.js";

export type ToolLog = {
  id: number;
  conversation_id: number | null;
  tool_name: string;
  args: string; // stored as JSON text
  ok: 0 | 1; // SQLite has no boolean type → 0 or 1
  output: string;
  created_at: string;
};

export function logToolCall(entry: {
  conversationId: number | null;
  toolName: string;
  args: unknown;
  ok: boolean;
  output: string;
}): void {
  db.prepare(
    "INSERT INTO tool_logs (conversation_id, tool_name, args, ok, output) VALUES (?, ?, ?, ?, ?)",
  ).run(
    entry.conversationId,
    entry.toolName,
    JSON.stringify(entry.args ?? {}),
    entry.ok ? 1 : 0,
    entry.output.slice(0, 2000),
  );
}

export function listToolLogs(limit = 50): ToolLog[] {
  return db.prepare("SELECT * FROM tool_logs ORDER BY id DESC LIMIT ?").all(limit) as ToolLog[];
}
