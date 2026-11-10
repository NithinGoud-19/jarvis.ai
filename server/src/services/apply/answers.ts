/**
 * Decides what to do with each form field — PURE logic (no browser), so it's easy to test.
 *
 * 📘 LESSON: Keep decisions separate from side effects
 * "What should go in this field?" (rules) is separated from "type it into the page" (Playwright).
 * The rules can be tested with plain objects in milliseconds; the browser part stays small.
 *
 * Every field gets ONE decision:
 *   fill     → type a value we KNOW from your profile (name, email, city…)
 *   choose   → pick an option (Yes/No, India…) — only from your profile/answers
 *   upload   → attach your resume
 *   draft    → open question ("Why do you want to join?") → AI writes a draft for you to edit
 *   sensitive→ gender, race, disability, age… → ALWAYS left to you
 *   ask      → JARVIS doesn't know (or it's a legal consent) → listed under "needs you"
 *   ignore   → not a real question (unlabelled helper inputs, Twitter…)
 */
import type { Profile } from "../profile.js";
import type { FieldOption, FormField } from "./readForm.js";

/** Several choices ("select all that apply") are saved as one text: "LinkedIn | Glassdoor". */
export const ANSWER_SEPARATOR = " | ";

export type Decision =
  | { action: "fill"; value: string; remembered?: string } // remembered = answer-bank key it came from
  | { action: "choose"; answer: string; option?: FieldOption; alternatives?: string[]; more?: FieldOption[]; remembered?: string }
  | { action: "upload" }
  | { action: "draft" }
  | { action: "sensitive" }
  | { action: "ask"; reason: string; consent?: boolean } // consent → never learned, you tick it every time
  | { action: "ignore" };

export type Facts = {
  first: string;
  last: string;
  full: string;
  email: string;
  phone: string;
  phoneLocal: string; // without the country code — for forms with a separate "+91" box (Workday)
  city: string;
  state: string;
  country: string;
  linkedin: string;
  github: string;
  currentCompany: string;
  currentTitle: string;
  years: number;
  notice: string;
  expectedCtcLpa: number | null;
  degreeLevel: string; // "Bachelor" / "Master" … (Workday's Degree list)
  fieldOfStudy: string; // "Civil Engineering"
  answers: Record<string, string>;
};

export function factsFromProfile(p: Profile): Facts {
  const parts = p.name.trim().split(/\s+/);
  const current = p.experience.find((e) => e.to === null) ?? p.experience[0];
  const degree = String(p.education[0]?.degree ?? ""); // "B.Tech, Civil Engineering"
  return {
    first: parts[0],
    last: parts.slice(1).join(" ") || parts[0],
    full: p.name,
    email: p.email ?? "",
    phone: p.phone ?? "",
    phoneLocal: (p.phone ?? "").replace(/^\+\d{1,3}[\s-]*/, "").replace(/[\s-]/g, ""),
    city: p.city,
    state: p.state ?? "",
    country: p.country ?? "",
    linkedin: p.linkedin ?? "",
    github: p.github ?? "",
    currentCompany: current?.company ?? "",
    currentTitle: current?.title ?? "",
    years: p.experienceYears,
    notice: p.noticePeriod ?? "",
    expectedCtcLpa: p.expectedCtcLpa ?? null,
    degreeLevel: degreeLevel(degree),
    fieldOfStudy: degree.split(",").slice(1).join(",").trim(),
    answers: p.answers,
  };
}

// Questions JARVIS must NEVER answer for you.
const SENSITIVE =
  /gender|pronoun|\brace\b|ethnic|hispanic|latin[oa]|veteran|disabilit|sexual|orientation|transgender|\bage\b|how old|date of birth|\bbirth|religio|caste|marital|self[- ]identif|nationality|citizenship/i;
// Legal consent — you should read and tick these yourself.
const CONSENT = /\b(i agree|i consent|consent to|acknowledge|privacy|terms|certify|declare|i confirm|i understand)\b/i;
// Open questions worth an AI draft.
const OPEN = /\bwhy\b|tell us|describe|explain|what (interests|excites|motivates)|motivat|about yourself|cover letter|anything else|additional information|summary/i;

/** A rule returns the answer, or candidates in order (e.g. city, then country). null = unknown, "" = ignore. */
type Rule = { test: RegExp; answer: (f: Facts, ctx: Ctx) => string | string[] | null };
type Ctx = { company: string; field: FormField };

/** Ordered: the FIRST matching rule wins (so "preferred first name" is caught before "first name"). */
const RULES: Rule[] = [
  { test: /twitter|\bx\.com|facebook|instagram/i, answer: () => "" }, // "" → ignore
  // Workday extras you don't need: "I have a preferred name" box, local-script names, extension, skill tags.
  { test: /have a preferred name|^local (given|family|first|last) name|phone extension|type to add skills/i, answer: () => "" },
  { test: /preferred (first )?name|first name|given name/i, answer: (f) => f.first },
  { test: /last name|surname|family name/i, answer: (f) => f.last },
  { test: /full name|legal name|your name|^name$/i, answer: (f) => f.full },
  { test: /e-?mail/i, answer: (f) => f.email },
  { test: /phone device type|phone type/i, answer: () => "Mobile" },
  { test: /phone code|country code|dial(l)?ing code/i, answer: (f) => f.country || null },
  // Workday has a separate "+91" box → the number alone. Other forms get the full "+91 …".
  { test: /phone|mobile|contact number/i, answer: (f, c) => (/phoneNumber/.test(c.field.idHint ?? "") ? f.phoneLocal : f.phone) },
  { test: /linkedin/i, answer: (f) => f.linkedin },
  { test: /github/i, answer: (f) => f.github },
  { test: /portfolio|website|personal site|blog|other (url|link)/i, answer: (f) => f.github },
  // "Have you ever been employed by New Relic?" → No (unless it's a company you worked at).
  {
    test: /(employed|worked|working) (by|for|at)|employed with|former employee|previously (worked|employed)|current(ly)? (an )?employee/i,
    answer: (f, c) => (c.company && new RegExp(escapeRe(f.currentCompany), "i").test(c.field.question) ? "Yes" : "No"),
  },
  { test: /authori[sz]ed to work|legally (eligible|authori[sz]ed)|right to work|eligible to work|work permit/i, answer: (f) => f.answers.workAuthorized ?? null },
  { test: /sponsor|visa/i, answer: (f) => f.answers.needsSponsorship ?? null },
  // If an option says "I'm based in Hyderabad", that's the honest pick; otherwise your standard answer.
  { test: /relocat/i, answer: (f) => [`based in ${f.city}`, f.answers.willingToRelocate ?? ""].filter(Boolean) },
  { test: /hybrid|work(ing)? from (the )?office|on-?site|in[- ]office|days (a week )?(from|in) (the )?office|from (one of )?our offices?|commit to working/i, answer: (f) => f.answers.hybridOk ?? null },
  { test: /managing (a team|direct reports|people)|people manager|direct reports|managed (a )?team|team management/i, answer: () => "No" },
  { test: /were you referred|referred by|referral/i, answer: () => "No" },
  { test: /(been )?interviewed (by|with|at)/i, answer: () => "No" },
  { test: /how did you (hear|find|learn)|where did you (hear|find)/i, answer: (f) => f.answers.heardFrom ?? null },
  { test: /notice period/i, answer: (f, c) => noticeAnswer(f, c.field) },
  { test: /(join|start).{0,30}within|when can you (join|start)|immediate(ly)? (join|start|available)|availability to (join|start)/i, answer: (f, c) => (isChoice(c.field) ? "Yes" : f.notice || null) },
  { test: /expected (ctc|salary|compensation|pay)|salary expectation|desired (salary|compensation)/i, answer: (f, c) => ctc(f, c.field) },
  { test: /current (ctc|salary|compensation)/i, answer: () => null },
  // Text box → "1". Yes/No ("Do you have 3+ years of React?") → compare the number with your years.
  {
    test: /years of (relevant |professional |total |work )?experience|how many years|\d+\+? years/i,
    answer: (f, c) => {
      if (!isChoice(c.field)) return String(f.years);
      const asked = Number(c.field.question.match(/(\d{1,2})\s*\+?\s*(?:or more )?years?/i)?.[1]);
      return Number.isFinite(asked) ? (f.years >= asked ? "Yes" : "No") : null;
    },
  },
  { test: /current (company|employer|organi[sz]ation)|^company$|^organi[sz]ation$/i, answer: (f) => f.currentCompany || null },
  { test: /current (job )?(title|role|designation|position)/i, answer: (f) => f.currentTitle || null },
  { test: /^degree$|highest (level of )?(education|degree)|education level|level of education/i, answer: (f) => f.degreeLevel || null },
  { test: /field of study|\bmajor\b|discipline|speciali[sz]ation/i, answer: (f) => f.fieldOfStudy || null },
  { test: /country/i, answer: (f) => f.country || null },
  { test: /\bstate\b|province|region/i, answer: (f) => [f.state, "N/A"].filter(Boolean) }, // Greenhouse: "not in US/Australia → select N/A"
  { test: /\bcity\b|location|where are you based|currently (located|based|residing)|reside/i, answer: (f) => [f.city, f.country].filter(Boolean) },
];

/**
 * 📘 Answer bank: your past answers, keyed by the SIMPLIFIED question.
 * The company name is replaced by a placeholder, so an answer given for one company
 * is reused for the same question at another company.
 */
export function questionKey(question: string, company: string): string {
  // "(select all that apply)", "(optional)" … don't change the question → drop them.
  let q = question.toLowerCase().replace(/\([^)]*\)/g, " ");
  for (const name of [company, company.split(/[\s.]/)[0]].filter((n) => n.length > 2)) {
    q = q.split(name.toLowerCase()).join(" thecompany ");
  }
  return norm(q).slice(0, 300);
}

/** Rules first (your profile is the source of truth); if they don't know, look in the answer bank. */
export function decide(field: FormField, facts: Facts, company: string, bank: Map<string, string> = new Map()): Decision {
  const d = decideByRules(field, facts, company);
  if (d.action !== "ask" || CONSENT.test(field.question)) return d;
  const key = questionKey(field.question, company);
  const saved = bank.get(key);
  return (saved && fromBank(field, saved, key)) || d;
}

function fromBank(field: FormField, saved: string, key: string): Decision | null {
  const parts = saved.split(ANSWER_SEPARATOR).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (field.kind === "text" || field.kind === "textarea") return { action: "fill", value: saved, remembered: key };
  // Options often carry company-specific extras: "LinkedIn (New Relic Page)" at one company is
  // plain "LinkedIn" at the next → also try each part without its (brackets).
  const plain = (p: string) => p.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (field.kind === "combobox" || field.kind === "multiselect" || (field.kind === "listbox" && !field.options?.length)) {
    return { action: "choose", answer: parts[0], alternatives: plain(parts[0]) !== parts[0] ? [plain(parts[0])] : [], remembered: key };
  }
  const matched = parts
    .map((p) => bestOption(field.options ?? [], p) ?? bestOption(field.options ?? [], plain(p)))
    .filter((o): o is FieldOption => !!o);
  if (matched.length === 0) return null; // the options changed → ask again
  const [option, ...more] = field.kind === "checkbox" ? matched : matched.slice(0, 1);
  return { action: "choose", answer: option.label, option, more, remembered: key };
}

function decideByRules(field: FormField, facts: Facts, company: string): Decision {
  const q = field.question.trim();
  if (field.kind === "file") {
    // Workday has ONE upload box for "Resume/CV, Cover Letter…" (automation id file-upload-input-ref).
    return /resume|cv\b|file-upload-input/i.test(`${q} ${field.idHint}`) ? { action: "upload" } : { action: "ignore" }; // cover letter = optional
  }
  const sensitiveOptions = field.options?.some((o) => /^(male|female|non-binary|he\/him|she\/her|asian|white|\d+ or younger)\b/i.test(o.label));
  if (sensitiveOptions || (q && SENSITIVE.test(q))) return { action: "sensitive" };
  if (!q) return { action: "ignore" }; // helper inputs with no question (react-select internals etc.)
  // Marketing text messages: not needed to apply → leave unticked.
  if (field.kind === "checkbox" && /\bsms\b|text messag/i.test(`${q} ${field.idHint}`)) return { action: "ignore" };
  if (CONSENT.test(q)) return { action: "ask", reason: "Consent / declaration — read and tick it yourself", consent: true };

  for (const rule of RULES) {
    if (!rule.test.test(q)) continue;
    const raw = rule.answer(facts, { company, field });
    if (raw === "") return { action: "ignore" };
    const candidates = raw === null ? [] : Array.isArray(raw) ? raw : [raw];
    if (candidates.length === 0) return { action: "ask", reason: "Not in your profile yet" };
    if (!isChoice(field)) return { action: "fill", value: candidates[0] };
    // Comboboxes show their options only after typing → try the candidates one by one later.
    // Comboboxes / Workday search boxes / unopened dropdowns: options appear later → try candidates in order.
    if (field.kind === "combobox" || field.kind === "multiselect" || (field.kind === "listbox" && !field.options?.length)) {
      return { action: "choose", answer: candidates[0], alternatives: candidates.slice(1) };
    }
    for (const answer of candidates) {
      const option = bestOption(field.options ?? [], answer);
      if (option) return { action: "choose", answer, option };
    }
    return { action: "ask", reason: `No option matches "${candidates[0]}"` };
  }

  if ((field.kind === "textarea" || field.kind === "text") && OPEN.test(q)) return { action: "draft" };
  if (field.kind === "textarea" && field.required) return { action: "draft" };
  return { action: "ask", reason: "JARVIS doesn't know this one" };
}

function isChoice(f: FormField): boolean {
  return ["select", "radio", "checkbox", "buttons", "combobox", "listbox", "multiselect"].includes(f.kind);
}

/** "Immediate" → "0" when the form asks for a NUMBER of days; "30 days" → "30". */
function noticeAnswer(f: Facts, field: FormField): string | null {
  if (!f.notice) return null;
  if (!/days/i.test(field.question) && field.inputType !== "number") return f.notice;
  if (/immediate/i.test(f.notice)) return "0";
  const n = f.notice.match(/\d+/)?.[0];
  if (!n) return f.notice;
  return /month/i.test(f.notice) ? String(Number(n) * 30) : n;
}

/** "B.Tech, Civil Engineering" → "Bachelor" (forms list degree LEVELS, not Indian degree names). */
function degreeLevel(degree: string): string {
  if (/\b(b\.?\s?tech|b\.?\s?e|b\.?\s?sc|bca|b\.?\s?com|b\.?\s?a|bachelor'?s?)\b/i.test(degree)) return "Bachelor";
  if (/\b(m\.?\s?tech|m\.?\s?e|m\.?\s?sc|mca|mba|m\.?\s?s|master'?s?)\b/i.test(degree)) return "Master";
  if (/ph\.?\s?d|doctor/i.test(degree)) return "Doctor";
  if (/diploma/i.test(degree)) return "Diploma";
  return "";
}

function ctc(f: Facts, field: FormField): string | null {
  if (f.expectedCtcLpa === null) return null;
  if (field.inputType === "number") return String(f.expectedCtcLpa * 100000); // 5 LPA → 500000
  return `${f.expectedCtcLpa} LPA`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") || "^$";
// Accents off first (NFD splits "ā" into "a" + accent mark): Workday writes "Telangāna", and
// without this it would become "telang na" and never match "Telangana".
const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Exact match first, then "starts with", then "contains" — so "India" beats "British Indian Ocean Territory". */
export function bestOption<T extends { label: string }>(options: T[], answer: string): T | undefined {
  const a = norm(answer);
  if (!a) return undefined;
  return (
    options.find((o) => norm(o.label) === a) ??
    options.find((o) => norm(o.label).startsWith(a + " ") || norm(o.label).startsWith(a)) ??
    options.find((o) => new RegExp(`\\b${escapeRe(a)}\\b`).test(norm(o.label)))
  );
}
