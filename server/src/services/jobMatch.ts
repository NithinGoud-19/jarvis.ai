/**
 * Match score: how well does a job fit YOUR profile? (0–100, no AI, runs in milliseconds)
 *
 * 📘 LESSON: Rules first, AI second
 * Your laptop's AI needs ~30–60 s per job. Scoring 50 jobs that way = 30+ minutes.
 * Simple RULES (find skill words, read "3+ years", check "Senior" in the title) score
 * every job instantly and explain WHY. The AI is used only when you ask for a deep look
 * at ONE job (see jobReview.ts). Real products mix both the same way.
 *
 *   score = 50% skills you have  +  30% experience fit  +  20% seniority fit
 */
import type { Profile } from "./profile.js";

/** Tech words we look for. Each has a regex that also catches common spellings. */
export const SKILLS: { name: string; re: RegExp }[] = [
  { name: "JavaScript", re: /\bjavascript\b|\bes6\b|\bjs\b/ },
  { name: "TypeScript", re: /\btypescript\b/ },
  { name: "React", re: /\breact(?:\.?js)?\b(?!\s*native)/ },
  { name: "React Native", re: /\breact\s*native\b/ },
  { name: "Redux", re: /\bredux\b/ },
  { name: "Next.js", re: /\bnext\.?js\b/ },
  { name: "Angular", re: /\bangular(?:js)?\b/ },
  { name: "Vue", re: /\bvue(?:\.?js)?\b/ },
  { name: "HTML", re: /\bhtml5?\b/ },
  { name: "CSS", re: /\bcss3?\b|\bsass\b|\bscss\b/ },
  { name: "Tailwind CSS", re: /\btailwind/ },
  { name: "Node.js", re: /\bnode(?:\.?js)?\b/ },
  { name: "Express", re: /\bexpress(?:\.?js)?\b/ },
  { name: "NestJS", re: /\bnest\.?js\b/ },
  { name: "REST APIs", re: /\brest(?:ful)?\b(?:\s*apis?)?|\bweb services?\b/ },
  { name: "GraphQL", re: /\bgraphql\b/ },
  { name: "Java", re: /\bjava\b(?!\s*script)/ },
  { name: "Spring", re: /\bspring(?:\s*boot)?\b/ },
  { name: "Python", re: /\bpython\b/ },
  { name: "Django", re: /\bdjango\b/ },
  { name: "Flask/FastAPI", re: /\bflask\b|\bfastapi\b/ },
  { name: "Go", re: /\bgolang\b/ },
  { name: "C#/.NET", re: /\bc#|\.net\b|\bdotnet\b|\basp\.net\b/ },
  { name: "C++", re: /\bc\+\+/ },
  { name: "Kotlin", re: /\bkotlin\b/ },
  { name: "Swift", re: /\bswift(?:ui)?\b/ },
  { name: "Flutter", re: /\bflutter\b/ },
  { name: "PHP", re: /\bphp\b|\blaravel\b/ },
  { name: "Ruby", re: /\bruby\b|\brails\b/ },
  { name: "SQL", re: /\bsql\b/ },
  { name: "MySQL", re: /\bmysql\b/ },
  { name: "PostgreSQL", re: /\bpostgre(?:s|sql)\b/ },
  { name: "MongoDB", re: /\bmongo(?:db)?\b/ },
  { name: "SQLite", re: /\bsqlite\b/ },
  { name: "Redis", re: /\bredis\b/ },
  { name: "Kafka", re: /\bkafka\b/ },
  { name: "Elasticsearch", re: /\belastic\s*search\b/ },
  { name: "Docker", re: /\bdocker\b|\bcontainers?\b/ },
  { name: "Kubernetes", re: /\bkubernetes\b|\bk8s\b/ },
  { name: "AWS", re: /\baws\b|\bamazon web services\b/ },
  { name: "Azure", re: /\bazure\b/ },
  { name: "GCP", re: /\bgcp\b|\bgoogle cloud\b/ },
  { name: "Git", re: /\bgit(?:hub|lab)?\b/ },
  { name: "CI/CD", re: /\bci\s*\/\s*cd\b|\bjenkins\b|\bgithub actions\b/ },
  { name: "Terraform", re: /\bterraform\b/ },
  { name: "Linux", re: /\blinux\b|\bunix\b/ },
  { name: "Microservices", re: /\bmicro-?services?\b/ },
  { name: "Testing", re: /\bjest\b|\bunit test|\bcypress\b|\bselenium\b|\bplaywright\b/ },
  { name: "Spark/Big Data", re: /\bspark\b|\bhadoop\b|\bdatabricks\b|\bsnowflake\b/ },
  { name: "Machine Learning", re: /\bmachine learning\b|\bpytorch\b|\btensorflow\b/ },
  { name: "LLMs / GenAI", re: /\bllms?\b|\bgen(?:erative)?\s*ai\b|\bprompt engineering\b/ },
  { name: "Salesforce/Apex", re: /\bapex\b|\blightning web components?\b|\blwc\b/ },
];

/** Knowing one skill means you (mostly) know another. */
const IMPLIES: Record<string, string[]> = {
  React: ["HTML", "CSS", "JavaScript"],
  "React Native": ["JavaScript"],
  TypeScript: ["JavaScript"],
  "Tailwind CSS": ["CSS"],
  Express: ["REST APIs", "Node.js"],
  MySQL: ["SQL"],
  SQLite: ["SQL"],
  PostgreSQL: ["SQL"],
};

export function findSkills(text: string): Set<string> {
  const t = text.toLowerCase();
  return new Set(SKILLS.filter((s) => s.re.test(t)).map((s) => s.name));
}

/** The skills from your profile, plus the ones they imply. */
export function profileSkills(p: Profile): Set<string> {
  const all = Object.values(p.skills).flat().join(", ");
  const have = findSkills(all);
  for (const s of [...have]) for (const extra of IMPLIES[s] ?? []) have.add(extra);
  return have;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15,
};

/**
 * "3+ years", "5 - 9 years", "8 to 13 years", "five years or more" → the minimum asked, per mention.
 * We take the HIGHEST of those minimums (one line says "5+ years leading teams", another
 * "15+ years in software" → 15 is the real bar).
 * Skips company facts like "founded more than 40 years ago" (the word "ago"/"old", or > 20).
 */
export function yearsRequired(text: string): number | null {
  const t = text.toLowerCase();
  const re =
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*(?:years?|yrs?)\b(?!\s+(?:ago|old))/g;
  let best: number | null = null;
  for (const m of t.matchAll(re)) {
    const n = NUMBER_WORDS[m[1]] ?? Number(m[1]);
    if (n >= 1 && n <= 20 && (best === null || n > best)) best = n;
  }
  return best;
}

function seniorityFit(title: string, years: number): { fit: number; note: string | null } {
  const t = title.toLowerCase();
  if (/\b(principal|staff|director|head|architect|vp|vice president|avp|manager)\b/.test(t))
    return { fit: years >= 8 ? 1 : 0.1, note: "Title is a very senior level" };
  if (/\b(lead|sr\.?|senior|iii|iv|smts)\b/.test(t))
    return { fit: years >= 4 ? 1 : 0.4, note: "Title says senior/lead" };
  if (/\b(junior|jr\.?|associate|intern|graduate|trainee|entry|i)\b/.test(t))
    return { fit: 1, note: "Entry/associate level title" };
  return { fit: 0.8, note: null };
}

export type MatchDetails = {
  have: string[];
  missing: string[];
  yearsAsked: number | null;
  reasons: string[];
  hasDescription: boolean;
};

export function scoreJob(
  job: { title: string; description: string | null },
  profile: Profile,
  mySkills = profileSkills(profile),
): { score: number; details: MatchDetails } {
  const text = `${job.title}\n${job.description ?? ""}`;
  const asked = findSkills(text);
  const have = [...asked].filter((s) => mySkills.has(s));
  const missing = [...asked].filter((s) => !mySkills.has(s));
  const reasons: string[] = [];

  // 1. Skills (50%)
  let skillFit = 0.5; // unknown → neutral
  if (!job.description) reasons.push("No description available — skills not checked");
  else if (asked.size === 0) reasons.push("Description lists no specific tech");
  else {
    skillFit = have.length / asked.size;
    reasons.push(`You have ${have.length} of ${asked.size} skills it mentions`);
  }

  // 2. Experience (30%)
  const yearsAsked = job.description ? yearsRequired(job.description) : null;
  const mine = profile.experienceYears;
  let expFit = 0.6; // not stated → probably OK-ish
  if (yearsAsked !== null) {
    const gap = yearsAsked - mine;
    expFit = gap <= 0 ? 1 : gap === 1 ? 0.6 : gap <= 3 ? 0.25 : 0;
    reasons.push(gap <= 0 ? `Asks ${yearsAsked}+ years — you have ${mine}` : `Asks ${yearsAsked}+ years — you have ${mine} (${gap} short)`);
  }

  // 3. Seniority from the title (20%)
  const sen = seniorityFit(job.title, mine);
  if (sen.note) reasons.push(sen.note);

  const score = Math.round(100 * (0.5 * skillFit + 0.3 * expFit + 0.2 * sen.fit));
  return { score, details: { have, missing, yearsAsked, reasons, hasDescription: Boolean(job.description) } };
}
