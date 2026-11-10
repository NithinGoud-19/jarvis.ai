/**
 * Repository for the answer bank (saved_answers table).
 *
 * Multiple choices (e.g. "select all that apply") are stored in ONE text column,
 * separated by " | " — simple, and good enough for a personal app.
 */
import { db } from "./db.js";
export { ANSWER_SEPARATOR } from "../services/apply/answers.js";

export type SavedAnswer = {
  id: number;
  question_key: string;
  question: string;
  answer: string;
  uses: number;
  created_at: string;
  updated_at: string;
};

export function listSavedAnswers(): SavedAnswer[] {
  return db.prepare("SELECT * FROM saved_answers ORDER BY updated_at DESC").all() as SavedAnswer[];
}

/** key → answer, for fast lookup while filling a form. */
export function answerBank(): Map<string, string> {
  const rows = db.prepare("SELECT question_key, answer FROM saved_answers").all() as { question_key: string; answer: string }[];
  return new Map(rows.map((r) => [r.question_key, r.answer]));
}

export const saveAnswers = db.transaction((items: { key: string; question: string; answer: string }[]) => {
  const stmt = db.prepare(`
    INSERT INTO saved_answers (question_key, question, answer) VALUES (?, ?, ?)
    ON CONFLICT (question_key) DO UPDATE SET
      answer = excluded.answer, question = excluded.question, updated_at = datetime('now')
  `);
  for (const i of items) stmt.run(i.key, i.question, i.answer);
});

export function markAnswersUsed(keys: string[]): void {
  const stmt = db.prepare("UPDATE saved_answers SET uses = uses + 1 WHERE question_key = ?");
  for (const k of keys) stmt.run(k);
}

export function updateSavedAnswer(id: number, answer: string): SavedAnswer | undefined {
  return db
    .prepare("UPDATE saved_answers SET answer = ?, updated_at = datetime('now') WHERE id = ? RETURNING *")
    .get(answer, id) as SavedAnswer | undefined;
}

export function deleteSavedAnswer(id: number): boolean {
  return db.prepare("DELETE FROM saved_answers WHERE id = ?").run(id).changes > 0;
}
