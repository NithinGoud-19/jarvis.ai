/**
 * Repository for the settings table (key → value). Every setting has a DEFAULT here,
 * so a fresh database works without any setup, and the rest of the code gets typed values.
 */
import { db } from "./db.js";

const DEFAULTS = {
  /** City for the weather in the morning briefing (shown to the user). */
  weather_city: "Hyderabad",
  /** Where that city is: filled in by the geocoder when the city is saved. JSON {name, lat, lon}. */
  weather_place: "",
  /** "1" = read the briefing out loud the first time JARVIS is opened each morning. */
  briefing_autoplay: "1",
  /** Local date ("2026-11-13") of the last automatic briefing → only once per day. */
  briefing_last_autoplay: "",
} as const;

export type SettingKey = keyof typeof DEFAULTS;

export function getSetting(key: SettingKey): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULTS[key];
}

/** 📘 UPSERT again: insert the key, or update it if it already exists. */
export function setSetting(key: SettingKey, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, value);
}
