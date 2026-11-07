/**
 * 📘 LESSON: The database connection
 * SQLite stores the WHOLE database in one file: server/data/jarvis.db
 * We open it once when the server starts and reuse that connection everywhere.
 *
 * better-sqlite3 is "synchronous": db.prepare(...).get() returns the result directly
 * (no await). That's fine for SQLite because it is a local file and very fast.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { migrations } from "./migrations.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);

// Recommended SQLite settings
db.pragma("journal_mode = WAL"); // faster, safer writes
db.pragma("foreign_keys = ON"); // SQLite ignores FOREIGN KEY rules unless you turn this on!

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id      INTEGER PRIMARY KEY,
      name    TEXT NOT NULL,
      run_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const done = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((r) => (r as { id: number }).id),
  );

  for (const m of migrations) {
    if (done.has(m.id)) continue;
    // 📘 TRANSACTION: all-or-nothing. If any SQL fails, nothing is changed.
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name) VALUES (?, ?)").run(m.id, m.name);
    })();
    console.log(`🗄️  Migration ${m.id} applied: ${m.name}`);
  }
}

runMigrations();
