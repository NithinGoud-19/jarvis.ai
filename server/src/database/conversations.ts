/**
 * 📘 LESSON: Repository pattern
 * A "repository" is a file with all the SQL for ONE table (or a group of tables).
 * Routes call simple functions like createConversation("Hi") and never write SQL
 * themselves. If the database changes later, only this file changes.
 *
 * 📘 LESSON: SQL injection — ALWAYS use "?" placeholders
 *   ❌ db.prepare(`SELECT * FROM conversations WHERE id = ${id}`)   ← dangerous!
 *   ✅ db.prepare("SELECT * FROM conversations WHERE id = ?").get(id)
 * With "?", the value is sent separately and can never be run as SQL code.
 *
 * The 4 basic SQL commands (called CRUD):
 *   INSERT = Create · SELECT = Read · UPDATE = Update · DELETE = Delete
 */
import { db } from "./db.js";

export type Conversation = {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
};

export type StoredMessage = {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export function listConversations(): Conversation[] {
  return db
    .prepare("SELECT * FROM conversations ORDER BY updated_at DESC, id DESC")
    .all() as Conversation[];
}

export function getConversation(id: number): Conversation | undefined {
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as
    | Conversation
    | undefined;
}

export function createConversation(title: string): Conversation {
  const result = db.prepare("INSERT INTO conversations (title) VALUES (?)").run(title);
  return getConversation(Number(result.lastInsertRowid))!;
}

export function renameConversation(id: number, title: string): Conversation | undefined {
  db.prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?").run(
    title,
    id,
  );
  return getConversation(id);
}

/** Returns true if a row was deleted. Its messages are removed by ON DELETE CASCADE. */
export function deleteConversation(id: number): boolean {
  return db.prepare("DELETE FROM conversations WHERE id = ?").run(id).changes > 0;
}

export function listMessages(conversationId: number): StoredMessage[] {
  return db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id")
    .all(conversationId) as StoredMessage[];
}

export function addMessage(
  conversationId: number,
  role: "user" | "assistant",
  content: string,
): void {
  // Two writes that belong together → one transaction
  db.transaction(() => {
    db.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)").run(
      conversationId,
      role,
      content,
    );
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(
      conversationId,
    );
  })();
}
