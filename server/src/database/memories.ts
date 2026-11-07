/** Repository for long-term memories ("Remember that I like TypeScript"). */
import { db } from "./db.js";

export type Memory = { id: number; content: string; created_at: string };

export function listMemories(): Memory[] {
  return db.prepare("SELECT * FROM memories ORDER BY id").all() as Memory[];
}

export function addMemory(content: string): Memory {
  const result = db.prepare("INSERT INTO memories (content) VALUES (?)").run(content);
  return db.prepare("SELECT * FROM memories WHERE id = ?").get(result.lastInsertRowid) as Memory;
}

export function deleteMemory(id: number): boolean {
  return db.prepare("DELETE FROM memories WHERE id = ?").run(id).changes > 0;
}
