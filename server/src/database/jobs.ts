/**
 * Repository for the companies + jobs tables (all job-search SQL lives here).
 *
 * 📘 LESSON: UPSERT ("update or insert")
 * Every search finds many jobs we already saw last time. We don't want duplicates,
 * and we must NOT reset a job's status (if you marked it "applied", it stays applied).
 *   INSERT ... ON CONFLICT (company_id, external_id) DO UPDATE SET ...
 * = "insert this row; if that job already exists, just refresh a few columns instead".
 * The ON CONFLICT part only works because of the UNIQUE rule in migration 3.
 *
 * 📘 LESSON: JOIN
 * A job row only stores company_id (a number). To show the company NAME we JOIN:
 * "for each job, also fetch the companies row whose id = job.company_id".
 */
import { db } from "./db.js";
import type { MatchDetails } from "../services/jobMatch.js";

export type Ats = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workday";
export const ATS_LIST: Ats[] = ["greenhouse", "lever", "ashby", "smartrecruiters", "workday"];

export type Company = {
  id: number;
  name: string;
  ats: Ats;
  slug: string;
  wd_instance: string | null;
  wd_site: string | null;
  enabled: 0 | 1;
  created_at: string;
};

export const JOB_STATUSES = ["new", "saved", "applied", "interview", "offer", "rejected", "ignored"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type Job = {
  id: number;
  company_id: number;
  company: string; // from the JOIN
  external_id: string;
  title: string;
  location: string;
  url: string;
  posted_at: string | null;
  status: JobStatus;
  first_seen_at: string;
  last_seen_at: string;
  has_description: boolean;
  match_score: number | null;
  match_details: MatchDetails | null; // stored as JSON text, parsed here
  ai_review: AiReview | null; // stored as JSON text, parsed here
  ai_reviewed_at: string | null;
};

export type AiReview = {
  verdict: "strong" | "possible" | "weak";
  summary: string;
  matching: string[];
  gaps: string[];
  tips: string[];
};

// 📘 SQLite has no JSON or boolean column types → we store text / 0-1 and convert when reading.
type JobRow = Omit<Job, "has_description" | "match_details" | "ai_review"> & {
  has_description: 0 | 1;
  match_details: string | null;
  ai_review: string | null;
};
const toJob = (r: JobRow): Job => ({
  ...r,
  has_description: r.has_description === 1,
  match_details: r.match_details ? (JSON.parse(r.match_details) as MatchDetails) : null,
  ai_review: r.ai_review ? (JSON.parse(r.ai_review) as AiReview) : null,
});

// ---------- companies ----------

export function listCompanies(onlyEnabled = false): Company[] {
  const where = onlyEnabled ? "WHERE enabled = 1" : "";
  return db.prepare(`SELECT * FROM companies ${where} ORDER BY name`).all() as Company[];
}

export function addCompany(c: Pick<Company, "name" | "ats" | "slug" | "wd_instance" | "wd_site">): Company {
  return db
    .prepare(
      `INSERT INTO companies (name, ats, slug, wd_instance, wd_site)
       VALUES (@name, @ats, @slug, @wd_instance, @wd_site) RETURNING *`,
    )
    .get(c) as Company;
}

export function findCompany(ats: Ats, slug: string): Company | undefined {
  return db.prepare("SELECT * FROM companies WHERE ats = ? AND slug = ?").get(ats, slug) as Company | undefined;
}

export function deleteCompany(id: number): boolean {
  return db.prepare("DELETE FROM companies WHERE id = ?").run(id).changes > 0;
}

// ---------- jobs ----------

export type FoundJob = {
  companyId: number;
  externalId: string;
  title: string;
  location: string;
  url: string;
  postedAt: string | null;
  description: string | null;
};

const existsStmt = db.prepare("SELECT 1 FROM jobs WHERE company_id = ? AND external_id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO jobs (company_id, external_id, title, location, url, posted_at, description)
  VALUES (@companyId, @externalId, @title, @location, @url, @postedAt, @description)
  ON CONFLICT (company_id, external_id) DO UPDATE SET
    title        = excluded.title,
    location     = excluded.location,
    url          = excluded.url,
    posted_at    = COALESCE(excluded.posted_at, jobs.posted_at),
    description  = COALESCE(excluded.description, jobs.description),
    last_seen_at = datetime('now')
  RETURNING id
`);

/** Saves found jobs (no duplicates). Returns their ids and which ones are brand new. */
export const saveJobs = db.transaction((found: FoundJob[]) => {
  return found.map((j) => {
    const isNew = !existsStmt.get(j.companyId, j.externalId);
    const { id } = upsertStmt.get(j) as { id: number };
    return { id, isNew };
  });
});

// Lists leave out the (long) description — only "has_description". getJobDetail() includes it.
const SELECT_JOBS = `
  SELECT jobs.id, jobs.company_id, jobs.external_id, jobs.title, jobs.location, jobs.url, jobs.posted_at,
         jobs.status, jobs.first_seen_at, jobs.last_seen_at, jobs.match_score, jobs.match_details,
         jobs.ai_review, jobs.ai_reviewed_at, (jobs.description IS NOT NULL) AS has_description,
         companies.name AS company
  FROM jobs JOIN companies ON companies.id = jobs.company_id
`;

export function getJobsByIds(ids: number[]): Job[] {
  if (ids.length === 0) return [];
  const marks = ids.map(() => "?").join(",");
  return (db.prepare(`${SELECT_JOBS} WHERE jobs.id IN (${marks})`).all(...ids) as JobRow[]).map(toJob);
}

/** Tracker list. By default hides "ignored" jobs. */
export function listJobs(
  opts: { status?: JobStatus; search?: string; limit?: number; sort?: "score" | "recent" } = {},
): Job[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    where.push("jobs.status = ?");
    params.push(opts.status);
  } else {
    where.push("jobs.status != 'ignored'");
  }
  if (opts.search) {
    // 📘 Never glue user text into SQL! The "?" placeholder keeps it safe (no SQL injection).
    where.push("(jobs.title LIKE ? OR companies.name LIKE ? OR jobs.location LIKE ?)");
    const like = `%${opts.search}%`;
    params.push(like, like, like);
  }
  params.push(opts.limit ?? 500);
  // 📘 "IS NULL" sorts unscored jobs last; then highest score first
  const order =
    opts.sort === "score"
      ? "jobs.match_score IS NULL, jobs.match_score DESC, jobs.id DESC"
      : "jobs.last_seen_at DESC, jobs.id DESC";
  const rows = db
    .prepare(`${SELECT_JOBS} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`)
    .all(...params) as JobRow[];
  return rows.map(toJob);
}

export function updateJobStatus(id: number, status: JobStatus): Job | undefined {
  const changed = db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, id).changes;
  return changed ? getJobsByIds([id])[0] : undefined;
}

export function jobCounts(): Record<string, number> {
  const rows = db.prepare("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").all() as { status: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

/** One job WITH its description (for the detail view and the AI review). */
export function getJobDetail(id: number): (Job & { description: string | null }) | undefined {
  const job = getJobsByIds([id])[0];
  if (!job) return undefined;
  const row = db.prepare("SELECT description FROM jobs WHERE id = ?").get(id) as { description: string | null };
  return { ...job, description: row.description };
}

/** What the scorer needs: title, description, and how to fetch a missing description. */
export type ScoringRow = { id: number; title: string; description: string | null; external_id: string; company: Company };

export function getJobsForScoring(ids?: number[]): ScoringRow[] {
  const where = ids ? `WHERE jobs.id IN (${ids.map(() => "?").join(",") || "NULL"})` : "";
  const rows = db
    .prepare(`SELECT jobs.id, jobs.title, jobs.description, jobs.external_id, jobs.company_id FROM jobs ${where}`)
    .all(...(ids ?? [])) as { id: number; title: string; description: string | null; external_id: string; company_id: number }[];
  const companies = new Map(listCompanies().map((c) => [c.id, c]));
  return rows.map((r) => ({ ...r, company: companies.get(r.company_id)! }));
}

export function setJobDescription(id: number, description: string | null): void {
  db.prepare("UPDATE jobs SET description = ? WHERE id = ?").run(description, id);
}

export const setMatchScores = db.transaction((scores: { id: number; score: number; details: MatchDetails }[]) => {
  const stmt = db.prepare("UPDATE jobs SET match_score = ?, match_details = ? WHERE id = ?");
  for (const s of scores) stmt.run(s.score, JSON.stringify(s.details), s.id);
});

export function setAiReview(id: number, review: AiReview): void {
  db.prepare("UPDATE jobs SET ai_review = ?, ai_reviewed_at = datetime('now') WHERE id = ?").run(JSON.stringify(review), id);
}
