/**
 * Live job search across all company career pages.
 *
 * 📘 LESSON: Doing many network calls in PARALLEL
 * Checking 27 companies one after another (each ~1–3 s) would take a minute.
 * Promise.allSettled() starts them ALL at once and waits for every one to finish.
 * "Settled" (not Promise.all) = one company failing does NOT ruin the whole search;
 * we simply report which ones failed.
 *
 * 📘 LESSON: Normalising text before comparing
 * Companies write "Full Stack", "Full-Stack", "Fullstack" or "full-stack". Before we
 * compare, we squash all of them into one form ("fullstack"). Same for backend/frontend.
 *
 * How a search phrase is understood:
 *   "fullstack developer"       → role words ["fullstack"]          → must be in the TITLE
 *   "react developer"           → tech skills [React]               → in the title OR description
 *   "node.js backend engineer"  → role ["backend"] + tech [Node.js] → both rules
 */
import { fetchCompanyJobs, fetchJobDescription, type AtsJob } from "../integrations/ats/fetchers.js";
import { getJobsByIds, listCompanies, saveJobs, type Company, type Job } from "../database/jobs.js";
import { findSkills, SKILLS } from "./jobMatch.js";
import { mapLimit, scoreJobs, type ScoringResult } from "./jobScoring.js";

// Words that don't tell us WHICH job → ignored when matching titles.
const GENERIC = new Set([
  "developer", "developers", "engineer", "engineers", "dev", "devs", "role", "roles", "job", "jobs",
  "position", "positions", "opening", "openings", "vacancy", "vacancies", "opportunity", "opportunities",
  "in", "at", "for", "the", "a", "an", "and", "of", "sde",
]);

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/full[\s-]*stack/g, "fullstack")
    .replace(/back[\s-]*end/g, "backend")
    .replace(/front[\s-]*end/g, "frontend")
    .replace(/node[\s.]*js/g, "node")
    .replace(/react[\s.]*js/g, "react")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

export type SearchTerms = { roleWords: string[]; skills: string[] };

/**
 * "Senior React Native developer" → { roleWords: ["senior"], skills: ["React Native"] }
 * Tech names are cut out first, so "react native" isn't also read as the role word "native".
 */
export function parseRole(role: string): SearchTerms {
  const skills = [...findSkills(role)];
  let rest = role.toLowerCase();
  for (const s of SKILLS) rest = rest.replace(new RegExp(s.re.source, "g"), " ");
  const roleWords = normalize(rest)
    .split(" ")
    .filter((w) => w && !GENERIC.has(w));
  return { roleWords, skills };
}

const ENGINEERING_TITLE = /develop|engineer|software|sde|programmer|architect/;

/**
 * Role words must be in the TITLE. Tech skills may be in the title or the description.
 * Jobs without a description (Workday/SmartRecruiters lists) were already found by the
 * platform's own full-text search for those skills, so we accept them.
 */
export function jobMatches(job: { title: string; description: string | null }, terms: SearchTerms): boolean {
  const title = normalize(job.title);
  const words = new Set(title.split(" "));
  if (terms.roleWords.length > 0) {
    if (!terms.roleWords.every((k) => words.has(k))) return false;
  } else if (!ENGINEERING_TITLE.test(title)) {
    return false;
  }
  if (terms.skills.length === 0 || job.description === null) return true;
  const found = findSkills(`${job.title}
${job.description}`);
  return terms.skills.every((s) => found.has(s));
}

// Other names people/companies use for the same place.
const LOCATION_ALIASES: Record<string, string[]> = {
  hyderabad: ["hyderabad", "secunderabad", "telangana", "hitec", "gachibowli"],
  bangalore: ["bangalore", "bengaluru"],
  bengaluru: ["bangalore", "bengaluru"],
  gurgaon: ["gurgaon", "gurugram"],
  gurugram: ["gurgaon", "gurugram"],
  mumbai: ["mumbai", "bombay"],
  chennai: ["chennai", "madras"],
};

/**
 * "India" = the word India/IND, OR any Indian city/state. Jobs often say just
 * "Bengaluru, Karnataka" without the country, so the country name alone would miss them.
 */
const INDIA_PLACES = [
  "india", "hyderabad", "secunderabad", "telangana", "bangalore", "bengaluru", "karnataka",
  "chennai", "tamil nadu", "coimbatore", "mumbai", "pune", "maharashtra", "nagpur", "delhi",
  "new delhi", "ncr", "gurgaon", "gurugram", "noida", "haryana", "uttar pradesh", "lucknow",
  "kolkata", "west bengal", "ahmedabad", "gujarat", "vadodara", "jaipur", "rajasthan", "kochi",
  "cochin", "kerala", "trivandrum", "thiruvananthapuram", "chandigarh", "mohali", "indore",
  "bhubaneswar", "visakhapatnam", "vizag", "vijayawada", "andhra pradesh", "mysore", "mysuru",
  "mangalore", "goa", "bhopal", "nashik",
];
// Whole words only: "Indianapolis" must NOT count as India. "ind" = "Hyderabad, TS, IND" (Lever style).
const INDIA_RE = new RegExp(`(^|[^a-z])(${[...INDIA_PLACES, "ind"].join("|")})([^a-z]|$)`);

export function isInIndia(jobLocation: string): boolean {
  return INDIA_RE.test(jobLocation.toLowerCase());
}

export function locationMatches(jobLocation: string, wanted: string): boolean {
  const w = wanted.trim().toLowerCase();
  if (!w || w === "any" || w === "anywhere") return true;
  const loc = jobLocation.toLowerCase();
  // Workday sometimes only says "2 Locations"; its own search already included the place → keep it.
  if (/^\d+ locations$/.test(loc)) return true;
  if (w === "india" || w === "all india" || w === "pan india") return isInIndia(loc);
  if (w === "remote") return /remote|anywhere/.test(loc);
  return (LOCATION_ALIASES[w] ?? [w]).some((alias) => loc.includes(alias));
}

/** Text we send to the platforms that support searching (Workday, SmartRecruiters). */
function searchTextFor(terms: SearchTerms, role: string): string {
  const parts = [...terms.roleWords.map((k) => (k === "fullstack" ? "full stack" : k)), ...terms.skills];
  return parts.length ? parts.join(" ") : role;
}

export type JobSearchResult = {
  role: string;
  location: string;
  companiesSearched: number;
  failed: { company: string; error: string }[];
  jobs: (Job & { isNew: boolean })[];
  newCount: number;
  scoring: ScoringResult;
  ms: number;
};

export async function searchJobs(role: string, location: string): Promise<JobSearchResult> {
  const started = Date.now();
  const terms = parseRole(role);
  const query = { searchText: searchTextFor(terms, role), location };
  const companies = listCompanies(true);

  // 1. Ask every company's career page at the same time
  const results = await Promise.allSettled(companies.map((c) => fetchCompanyJobs(c, query)));

  // 2. Keep only jobs whose title AND location match
  const failed: JobSearchResult["failed"] = [];
  const matches: { company: Company; job: AtsJob }[] = [];
  results.forEach((r, i) => {
    const company = companies[i];
    if (r.status === "rejected") {
      failed.push({ company: company.name, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
      return;
    }
    for (const job of r.value) {
      if (locationMatches(job.location, location) && jobMatches(job, terms)) {
        matches.push({ company, job });
      }
    }
  });

  // 3. Workday/SmartRecruiters lists have no descriptions → fetch them now (max 6 at a time)
  //    and check again, so a "react" search can't keep a job that never mentions React.
  await mapLimit(
    matches.filter((m) => m.job.description === null),
    6,
    async (m) => {
      m.job.description = await fetchJobDescription(m.company, m.job.externalId).catch(() => null);
    },
  );
  const confirmed = matches.filter((m) => m.job.description === null || jobMatches(m.job, terms));

  // 4. Save to the database (no duplicates, statuses kept)
  const saved = saveJobs(
    confirmed.map(({ company, job }) => ({ companyId: company.id, ...job })),
  );
  // 5. Score them against your profile
  const scoring = await scoreJobs(saved.map((s) => s.id));

  const isNew = new Map(saved.map((s) => [s.id, s.isNew]));
  const jobs = getJobsByIds(saved.map((s) => s.id))
    .map((j) => ({ ...j, isNew: isNew.get(j.id) ?? false }))
    // best match first
    .sort((a, b) => (b.match_score ?? -1) - (a.match_score ?? -1));

  return {
    role,
    location,
    companiesSearched: companies.length,
    failed,
    jobs,
    newCount: jobs.filter((j) => j.isNew).length,
    scoring,
    ms: Date.now() - started,
  };
}
