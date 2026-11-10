/**
 * Your profile (data/profile.json — never committed: it is personal data).
 *
 * 📘 LESSON: Validate data you READ, not only data users SEND
 * A JSON file can be edited by hand and get a typo. zod checks it when we load it,
 * so a broken file gives a clear error instead of strange bugs later.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "../config.js";

const profileSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  city: z.string().default("Hyderabad"),
  state: z.string().optional(),
  country: z.string().optional(),
  linkedin: z.string().optional(),
  github: z.string().optional(),
  targetRole: z.string().default("Full Stack Developer"),
  experienceYears: z.number().min(0).max(50),
  noticePeriod: z.string().optional(),
  expectedCtcLpa: z.number().optional(),
  skills: z.record(z.string(), z.array(z.string())),
  experience: z
    .array(z.object({ company: z.string(), title: z.string(), from: z.string(), to: z.string().nullable(), points: z.array(z.string()) }).passthrough())
    .default([]),
  projects: z.array(z.object({ name: z.string(), tech: z.array(z.string()) }).passthrough()).default([]),
  education: z.array(z.object({ degree: z.string().nullable() }).passthrough()).default([]),
  // Your standard answers to common application questions (used by the form-filler).
  // Keys: workAuthorized, needsSponsorship, willingToRelocate, hybridOk, heardFrom — values like "Yes" / "No".
  answers: z.record(z.string(), z.string()).default({}),
});
export type Profile = z.infer<typeof profileSchema>;

const DATA_DIR = path.dirname(config.dbPath);
const PROFILE_PATH = path.join(DATA_DIR, "profile.json");
/** Your resume PDF, attached by the form-filler. */
export const RESUME_PATH = path.join(DATA_DIR, "resume.pdf");

let cache: { mtimeMs: number; profile: Profile } | null = null;

/** Reads the profile (re-reads automatically when you edit the file). Null if there is none yet. */
export function loadProfile(): Profile | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(PROFILE_PATH);
  } catch {
    return null;
  }
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache.profile;
  const parsed = profileSchema.safeParse(JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8")));
  if (!parsed.success) {
    throw new Error(`data/profile.json is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  cache = { mtimeMs: stat.mtimeMs, profile: parsed.data };
  return parsed.data;
}
