/**
 * 📘 LESSON: Migrations
 * A database has a "schema" (its tables and columns). Over time we will add more
 * tables (tasks, emails, jobs...). A MIGRATION is one numbered step that changes the
 * schema. Rules:
 *   1. Never edit an old migration after it has run — add a NEW one instead.
 *   2. Each migration runs only once. We remember which ran in the "schema_migrations" table.
 * This way your database and your friend's database always end up the same.
 *
 * 📘 LESSON: Tables, columns, keys
 *   - TABLE       = like an Excel sheet (conversations, messages, memories)
 *   - COLUMN      = one field (title, content, created_at)
 *   - PRIMARY KEY = unique id for each row
 *   - FOREIGN KEY = a link to a row in another table
 *       messages.conversation_id → conversations.id
 *       "ON DELETE CASCADE" = delete a conversation → its messages are deleted too
 */
export const migrations: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "create conversations, messages, memories",
    sql: `
      CREATE TABLE conversations (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE messages (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role             TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
        content          TEXT    NOT NULL,
        created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      -- An INDEX makes "find all messages of conversation X" fast (like a book's index)
      CREATE INDEX idx_messages_conversation ON messages(conversation_id);

      CREATE TABLE memories (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        content     TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    // 📘 Notice: we did NOT edit migration 1. New table = new migration.
    id: 2,
    name: "create tool_logs",
    sql: `
      CREATE TABLE tool_logs (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id  INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
        tool_name        TEXT    NOT NULL,
        args             TEXT    NOT NULL,
        ok               INTEGER NOT NULL,
        output           TEXT    NOT NULL,
        created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];
