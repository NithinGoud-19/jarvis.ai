/**
 * 📘 LESSON: Where do secrets live?
 * OAuth tokens are like house keys to your Gmail. Rules we follow:
 *   1. NOT in the normal database tables (those get read, listed, exported...)
 *   2. NOT in Git (data/ is in .gitignore)
 *   3. NEVER sent to the browser, and NEVER given to the AI
 *   4. Delete them when the user disconnects
 * We keep them in their own small file: server/data/secrets/google-oauth.json
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";

export type GoogleTokens = {
  accessToken: string; // short-lived key (~1 hour)
  refreshToken: string; // long-lived key used to get new access tokens
  expiresAt: number; // when accessToken expires (ms since 1970)
  email: string;
  scope: string;
};

const file = path.join(path.dirname(config.dbPath), "secrets", "google-oauth.json");

export function loadTokens(): GoogleTokens | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as GoogleTokens;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: GoogleTokens): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function deleteTokens(): void {
  fs.rmSync(file, { force: true });
}
