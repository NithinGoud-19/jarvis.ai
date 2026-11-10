/**
 * 📘 LESSON: Reading company career pages through their public job APIs
 *
 * Most company career pages are not built by the company — they use a hiring platform
 * called an ATS (Applicant Tracking System). The ATS shows the jobs on the careers page
 * AND publishes the same live list as free public JSON. Reading that JSON is:
 *   - live    → it is exactly what the careers page shows right now
 *   - legal   → these APIs are public and meant to be used for job boards
 *   - stable  → no HTML scraping that breaks when the page design changes
 *
 *   Greenhouse       GET  boards-api.greenhouse.io/v1/boards/{slug}/jobs          (all jobs)
 *   Lever            GET  api.lever.co/v0/postings/{slug}?mode=json                (all jobs)
 *   Ashby            GET  api.ashbyhq.com/posting-api/job-board/{slug}             (all jobs)
 *   SmartRecruiters  GET  api.smartrecruiters.com/v1/companies/{slug}/postings?q=  (search)
 *   Workday          POST {slug}.{wdN}.myworkdayjobs.com/wday/cxs/{slug}/{site}/jobs (search)
 *
 * Every fetcher turns its platform's own format into ONE common shape (AtsJob).
 * This is the "adapter" pattern: the rest of JARVIS never cares which ATS a company uses.
 */
import type { Company } from "../../database/jobs.js";
import { htmlToText } from "../../utils/html.js";

export type AtsJob = {
  externalId: string;
  title: string;
  location: string;
  url: string;
  postedAt: string | null;
  /** Plain-text description, when the list API includes it (Greenhouse, Lever, Ashby). */
  description: string | null;
};

/** What to search for. Greenhouse/Lever/Ashby ignore it (they return every job, we filter later). */
export type AtsQuery = { searchText: string; location: string };

const TIMEOUT_MS = 20_000;

// 📘 A slow company must not freeze the whole search → every request gets a timeout.
async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", "User-Agent": "JARVIS-personal-job-search", ...init?.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function greenhouse(c: Company): Promise<AtsJob[]> {
  type R = { jobs: { id: number; title: string; location?: { name?: string }; absolute_url: string; updated_at?: string; content?: string }[] };
  const data = await getJson<R>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(c.slug)}/jobs?content=true`);
  return data.jobs.map((j) => ({
    externalId: String(j.id),
    title: j.title,
    location: j.location?.name ?? "",
    url: j.absolute_url,
    postedAt: j.updated_at ?? null,
    description: htmlToText(j.content),
  }));
}

async function lever(c: Company): Promise<AtsJob[]> {
  type R = {
    id: string; text: string; hostedUrl: string; createdAt?: number;
    categories?: { location?: string; allLocations?: string[] };
    descriptionPlain?: string; lists?: { text: string; content: string }[]; additionalPlain?: string;
  }[];
  const data = await getJson<R>(`https://api.lever.co/v0/postings/${encodeURIComponent(c.slug)}?mode=json`);
  return data.map((j) => ({
    externalId: j.id,
    title: j.text,
    location: (j.categories?.allLocations?.length ? j.categories.allLocations : [j.categories?.location ?? ""]).join(" / "),
    url: j.hostedUrl,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    description: htmlToText(
      [j.descriptionPlain ?? "", ...(j.lists ?? []).map((l) => `<p>${l.text}</p>${l.content}`), j.additionalPlain ?? ""].join("<p></p>"),
    ),
  }));
}

async function ashby(c: Company): Promise<AtsJob[]> {
  type R = { jobs: { id: string; title: string; location?: string; secondaryLocations?: { location?: string }[]; jobUrl: string; publishedAt?: string; isListed?: boolean; descriptionHtml?: string }[] };
  const data = await getJson<R>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(c.slug)}`);
  return data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) => ({
      externalId: j.id,
      title: j.title,
      location: [j.location ?? "", ...(j.secondaryLocations ?? []).map((s) => s.location ?? "")].filter(Boolean).join(" / "),
      url: j.jobUrl,
      postedAt: j.publishedAt ?? null,
      description: htmlToText(j.descriptionHtml),
    }));
}

async function smartrecruiters(c: Company, q: AtsQuery): Promise<AtsJob[]> {
  type R = { content: { id: string; name: string; releasedDate?: string; location?: { fullLocation?: string; city?: string } }[] };
  const params = new URLSearchParams({ q: q.searchText, limit: "100" });
  const data = await getJson<R>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(c.slug)}/postings?${params}`);
  return data.content.map((j) => ({
    externalId: j.id,
    title: j.name,
    location: j.location?.fullLocation?.replace(/,\s*,/g, ",") ?? j.location?.city ?? "",
    url: `https://jobs.smartrecruiters.com/${encodeURIComponent(c.slug)}/${j.id}`,
    postedAt: j.releasedDate ?? null,
    description: null, // not in the list → fetchJobDescription()
  }));
}

async function workday(c: Company, q: AtsQuery): Promise<AtsJob[]> {
  if (!c.wd_instance || !c.wd_site) throw new Error("Workday company is missing wd_instance / wd_site");
  type R = { total: number; jobPostings?: { title: string; externalPath: string; locationsText?: string; postedOn?: string }[] };
  const base = `https://${c.slug}.${c.wd_instance}.myworkdayjobs.com`;
  const api = `${base}/wday/cxs/${c.slug}/${c.wd_site}/jobs`;
  const jobs: AtsJob[] = [];
  // Workday gives max 20 jobs per page → read up to 3 pages (📘 "pagination")
  for (let offset = 0; offset < 60; offset += 20) {
    const data = await getJson<R>(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: `${q.searchText} ${q.location}`.trim() }),
    });
    for (const j of data.jobPostings ?? []) {
      jobs.push({
        externalId: j.externalPath,
        title: j.title,
        location: j.locationsText ?? "",
        url: `${base}/${c.wd_site}${j.externalPath}`,
        postedAt: null, // Workday only says "Posted 3 Days Ago" — we use first_seen_at instead
        description: null, // not in the list → fetchJobDescription()
      });
    }
    if (offset + 20 >= data.total) break;
  }
  return jobs;
}

const FETCHERS = { greenhouse, lever, ashby, smartrecruiters, workday };

/**
 * One job's full description. Needed for SmartRecruiters + Workday, whose LIST APIs
 * don't include it (one extra request per job). Others: returns null (we already have it).
 */
export async function fetchJobDescription(c: Company, externalId: string): Promise<string | null> {
  if (c.ats === "smartrecruiters") {
    type R = { jobAd?: { sections?: Record<string, { title?: string; text?: string }> } };
    const d = await getJson<R>(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(c.slug)}/postings/${encodeURIComponent(externalId)}`,
    );
    const sections = d.jobAd?.sections ?? {};
    // skip "companyDescription" — it describes the company, not the job
    const html = ["jobDescription", "qualifications", "additionalInformation"]
      .map((k) => (sections[k]?.text ? `<p>${sections[k].title ?? ""}</p>${sections[k].text}` : ""))
      .join("");
    return htmlToText(html);
  }
  if (c.ats === "workday") {
    type R = { jobPostingInfo?: { jobDescription?: string } };
    const d = await getJson<R>(
      `https://${c.slug}.${c.wd_instance}.myworkdayjobs.com/wday/cxs/${c.slug}/${c.wd_site}${externalId}`,
    );
    return htmlToText(d.jobPostingInfo?.jobDescription);
  }
  return null;
}

export function fetchCompanyJobs(c: Company, q: AtsQuery): Promise<AtsJob[]> {
  return FETCHERS[c.ats](c, q);
}

/**
 * Turns a careers-page link into { ats, slug, ... } so you can add a company by pasting its link.
 *   https://job-boards.greenhouse.io/zenoti          → greenhouse / zenoti
 *   https://jobs.lever.co/zeta                       → lever / zeta
 *   https://jobs.ashbyhq.com/notion                  → ashby / notion
 *   https://jobs.smartrecruiters.com/ServiceNow      → smartrecruiters / ServiceNow
 *   https://amgen.wd1.myworkdayjobs.com/en-US/Careers → workday / amgen / wd1 / Careers
 */
export function parseCareersUrl(
  raw: string,
): Pick<Company, "ats" | "slug" | "wd_instance" | "wd_site"> | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  const first = parts[0];
  const plain = (ats: Company["ats"], slug?: string) => (slug ? { ats, slug, wd_instance: null, wd_site: null } : null);

  if (/(^|\.)greenhouse\.io$/.test(host)) {
    // boards.greenhouse.io/embed/job_board?for=slug  or  job-boards.greenhouse.io/slug
    return plain("greenhouse", u.searchParams.get("for") ?? (first === "embed" ? undefined : first));
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") return plain("lever", first);
  if (host === "jobs.ashbyhq.com") return plain("ashby", first);
  if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") return plain("smartrecruiters", first);

  const wd = host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
  if (wd) {
    const site = parts.find((p) => !/^[a-z]{2}-[A-Z]{2}$/.test(p)); // skip the language part "en-US"
    return site ? { ats: "workday", slug: wd[1], wd_instance: wd[2], wd_site: site } : null;
  }
  return null;
}
