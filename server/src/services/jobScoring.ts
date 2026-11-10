/**
 * Scores saved jobs against your profile.
 *
 * 📘 LESSON: Limiting parallel requests ("concurrency limit")
 * Workday/SmartRecruiters need ONE extra request per job to get its description.
 * 40 requests all at once to the same company could look like an attack and get us
 * blocked. mapLimit() runs at most N at a time: when one finishes, the next starts.
 */
import { fetchJobDescription } from "../integrations/ats/fetchers.js";
import { getJobsForScoring, setJobDescription, setMatchScores } from "../database/jobs.js";
import { loadProfile } from "./profile.js";
import { profileSkills, scoreJob } from "./jobMatch.js";

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++; // safe: JavaScript runs one piece of code at a time
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export type ScoringResult = { scored: number; descriptionsFetched: number; noProfile: boolean };

/** Scores the given jobs (or ALL jobs, e.g. after you edit your profile). */
export async function scoreJobs(ids?: number[]): Promise<ScoringResult> {
  const profile = loadProfile();
  if (!profile) return { scored: 0, descriptionsFetched: 0, noProfile: true };

  const rows = getJobsForScoring(ids);

  // 1. Fetch missing descriptions (Workday / SmartRecruiters), max 6 at a time
  const missing = rows.filter((r) => !r.description && (r.company.ats === "workday" || r.company.ats === "smartrecruiters"));
  let fetched = 0;
  await mapLimit(missing, 6, async (r) => {
    try {
      r.description = await fetchJobDescription(r.company, r.external_id);
      setJobDescription(r.id, r.description);
      fetched++;
    } catch (err) {
      console.warn(`⚠️  No description for job ${r.id} (${r.company.name}): ${err instanceof Error ? err.message : err}`);
    }
  });

  // 2. Score them all (pure math — milliseconds)
  const mySkills = profileSkills(profile);
  setMatchScores(rows.map((r) => ({ id: r.id, ...scoreJob(r, profile, mySkills) })));
  return { scored: rows.length, descriptionsFetched: fetched, noProfile: false };
}
