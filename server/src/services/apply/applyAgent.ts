/**
 * The application form-filler (Step 3a: Greenhouse, Lever, Ashby · Step 3c: Workday).
 *
 *   startApply(jobId) → opens the job's application page in Edge, fills what it knows,
 *                       uploads your resume, drafts open answers… and STOPS.
 *   YOU review the form and click Submit yourself.
 *
 * Workday is different: an account login first, then 4–6 PAGES. JARVIS waits while you sign in,
 * fills one page, waits for YOU to click "Save and Continue", fills the next page … and stops
 * at "Review" — the Submit button there is always yours.
 *
 * 🔒 SAFETY: this file never clicks a submit/next button and never presses Enter in a normal field.
 *   The only things it clicks are: fields tagged by the form reader (inputs, Yes/No buttons and
 *   Workday dropdown buttons that are type="button"), and items in an open dropdown list.
 *   The one Enter: inside a Workday SEARCH box, where Enter means "search" (that's how Workday works).
 *
 * 📘 LESSON: Long-running tasks
 * Filling a form (+ AI drafts) can take a minute or more. An HTTP request shouldn't hang that long,
 * so POST /apply STARTS the work and answers immediately with a "session". The work continues in
 * the background and updates the session object; the UI asks "how is it going?" every 2 seconds
 * (GET /apply). This pattern is called POLLING.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright-core";
import { config } from "../../config.js";
import { getJobsForScoring, updateJobStatus, type Company, type Job } from "../../database/jobs.js";
import { answerBank, markAnswersUsed, saveAnswers } from "../../database/answers.js";
import { loadProfile, RESUME_PATH, type Profile } from "../profile.js";
import { READ_FORM_FN, READ_VALUES_FN, type FormField } from "./readForm.js";
import { bestOption, decide, factsFromProfile, questionKey, type Facts } from "./answers.js";
import { draftAnswer } from "./draft.js";

export type ApplyItem = { question: string; value?: string; reason?: string; remembered?: boolean };
/** waiting = JARVIS waits for YOU (Workday sign-in). */
export type ApplyState = "opening" | "waiting" | "filling" | "drafting" | "ready" | "error";
export type ApplySession = {
  jobId: number;
  title: string;
  company: string;
  url: string;
  state: ApplyState;
  startedAt: string;
  finishedAt: string | null;
  log: string[];
  filled: ApplyItem[];
  drafted: ApplyItem[];
  needsYou: ApplyItem[];
  sensitive: ApplyItem[];
  resumeUploaded: boolean;
  error: string | null;
  /** Answers YOU typed into "needs you" fields — saved to the answer bank when you click "I submitted it". */
  learning: ApplyItem[];
  done: boolean;
  /** Workday: the page you are on ("My Information" …) and what JARVIS wants you to do now. */
  step: string | null;
  hint: string | null;
};

export class ApplyError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const MAX_DRAFTS = 3; // each AI draft takes ~20–60 s on CPU
const BROWSER_DIR = path.join(path.dirname(config.dbPath), "browser-profile"); // keeps logins/cookies between runs
const LOGIN_WAIT_MS = 15 * 60_000; // how long JARVIS waits for you to sign in to Workday
const SESSION_MAX_MS = 60 * 60_000; // stop following a Workday application after 1 hour

/** Each ATS has one standard application page per job. Workday values come from the web → checked. */
export function applyUrl(c: Company, externalId: string): string | null {
  const id = encodeURIComponent(externalId);
  const slug = encodeURIComponent(c.slug);
  if (c.ats === "greenhouse") return `https://job-boards.greenhouse.io/${slug}/jobs/${id}`;
  if (c.ats === "lever") return `https://jobs.lever.co/${slug}/${id}/apply`;
  if (c.ats === "ashby") return `https://jobs.ashbyhq.com/${slug}/${id}/application`;
  if (c.ats === "workday") {
    const safe = /^[\w-]+$/;
    if (!safe.test(c.slug) || !safe.test(c.wd_instance ?? "") || !safe.test(c.wd_site ?? "")) return null;
    if (!/^\/job\/[\w\-.~%/]+$/.test(externalId)) return null; // "/job/India---Hyderabad/Fullstack-Developer_R-246940"
    return `https://${c.slug}.${c.wd_instance}.myworkdayjobs.com/en-US/${c.wd_site}${externalId}/apply/applyManually`;
  }
  return null; // SmartRecruiters: blocks automated browsers
}

// ---------- browser (one shared window, opened on first use) ----------
let contextPromise: Promise<BrowserContext> | null = null;

function getContext(): Promise<BrowserContext> {
  contextPromise ??= chromium
    .launchPersistentContext(BROWSER_DIR, {
      channel: config.browserChannel,
      headless: config.applyHeadless,
      viewport: null, // use the real window size
      args: ["--start-maximized"],
    })
    .then((ctx) => {
      ctx.on("close", () => (contextPromise = null)); // you closed the window → open a new one next time
      return ctx;
    })
    .catch((err) => {
      contextPromise = null;
      throw new ApplyError(`Couldn't open the browser (${err instanceof Error ? err.message.split("\n")[0] : err}).`, 500);
    });
  return contextPromise;
}

// ---------- sessions ----------
const sessions = new Map<number, ApplySession>();
const busy = (s?: ApplySession) => !!s && ["opening", "waiting", "filling", "drafting"].includes(s.state);
/** A newer "Fill again" replaced this session → the old background loop must stop. */
const stale = (s: ApplySession) => sessions.get(s.jobId) !== s;

export function getApplySession(jobId: number): ApplySession | undefined {
  return sessions.get(jobId);
}

export function startApply(jobId: number): ApplySession {
  const row = getJobsForScoring([jobId])[0];
  if (!row) throw new ApplyError("Job not found", 404);
  const existing = sessions.get(jobId);
  if (busy(existing)) return existing!;
  stopWatching(jobId); // "Fill again" → forget the old tab's answers
  const other = [...sessions.values()].find((s) => busy(s));
  if (other) throw new ApplyError(`Still filling "${other.title}" — wait for it to finish.`, 409);

  if (row.company.ats === "smartrecruiters") {
    throw new ApplyError(
      "SmartRecruiters shows a bot check to browsers controlled by a program, so JARVIS can't fill these forms. Open the job link and apply in your normal browser.",
    );
  }
  const url = applyUrl(row.company, row.external_id);
  if (!url) throw new ApplyError("JARVIS can't build the application link for this job. Open the job link and apply there.");
  const profile = loadProfile();
  if (!profile) throw new ApplyError("No profile yet (server/data/profile.json).");

  const session: ApplySession = {
    jobId,
    title: row.title,
    company: row.company.name,
    url,
    state: "opening",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    log: [],
    filled: [],
    drafted: [],
    needsYou: [],
    sensitive: [],
    resumeUploaded: false,
    error: null,
    learning: [],
    done: false,
    step: null,
    hint: null,
  };
  sessions.set(jobId, session);

  // Fire and forget: the work runs in the background; errors are stored on the session.
  const work = row.company.ats === "workday" ? runWorkday : runSinglePage;
  work(session, profile).catch((err) => {
    if (session.state !== "error") fail(session, err instanceof Error ? err.message.split("\n")[0] : String(err));
  });
  return session;
}

function fail(s: ApplySession, message: string): void {
  s.state = "error";
  s.error = message;
  s.hint = null;
  s.finishedAt = new Date().toISOString();
}

// ---------- one run = one tab + everything JARVIS needs while filling ----------
type Run = {
  s: ApplySession;
  page: Page;
  profile: Profile;
  facts: Facts;
  bank: Map<string, string>;
  usedKeys: string[];
  nextRef: number; // data-jarvis numbers are handed out here, so they never repeat in one session
};

const sel = (ref: string) => `[data-jarvis="${ref}"]`;

async function openTab(s: ApplySession, profile: Profile): Promise<Run> {
  s.log.push("Opening the application page…");
  const ctx = await getContext();
  const blank = ctx.pages().find((p) => p.url() === "about:blank");
  const page = blank ?? (await ctx.newPage());
  // 📘 Never THROW inside an event handler — nobody catches it, and it would crash the server.
  page.on("close", () => {
    if (busy(s)) fail(s, "The browser tab was closed before JARVIS finished.");
  });
  await page.goto(s.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  return { s, page, profile, facts: factsFromProfile(profile), bank: answerBank(), usedKeys: [], nextRef: 0 };
}

/** Greenhouse / Lever / Ashby: the whole form is on one page. */
async function runSinglePage(s: ApplySession, profile: Profile): Promise<void> {
  const run = await openTab(s, profile);
  const { page } = run;
  await page
    .waitForSelector("input[type=email], input[type=file], input[name=name], #first_name", { timeout: 25_000 })
    .catch(() => {
      throw new ApplyError("No application form found on the page — the job may be closed.");
    });
  await page.waitForTimeout(1500); // let the page's JavaScript finish building the form
  await page.evaluate(bannerScript("Check every field, then <b>you</b> click Submit."));
  s.state = "filling";

  const drafts = await fillPage(run);
  if (!s.resumeUploaded && !s.needsYou.some((i) => i.question === "Resume")) {
    add(s.needsYou, { question: "Resume", reason: "No resume upload box found" });
  }
  await writeDrafts(run, drafts);

  // "as ApplyState": TypeScript thinks state can't be "error" here, but the close handler may have changed it.
  if ((s.state as ApplyState) === "error" || stale(s)) return;
  await page.evaluate("window.scrollTo(0, 0)");
  await page.bringToFront();
  s.state = "ready";
  s.finishedAt = new Date().toISOString();
  markAnswersUsed(run.usedKeys);
  s.log.push("Done. Review the form in the browser, then click Submit yourself.");
  startWatching(s, page);
}

// ---------- Workday (Step 3c) ----------
/**
 * 📘 LESSON: A state machine
 * Workday is a series of pages, and JARVIS must react to where you ARE, not where it thinks you
 * should be. So it loops: "which page is open?" → sign-in → wait · a form page it hasn't filled →
 * fill it · Review → stop. You can click Back, refresh, or take a break — the loop just looks again.
 */
const WD = {
  signIn: '[data-automation-id="signInContent"], [data-automation-id="createAccountSubmitButton"], [data-automation-id="signInSubmitButton"]',
  next: '[data-automation-id="pageFooterNextButton"]',
  step: '[data-automation-id="progressBarActiveStep"] label',
};

async function workdayStep(page: Page): Promise<"signin" | "loading" | string> {
  if (await page.locator(WD.signIn).first().isVisible().catch(() => false)) return "signin";
  if (!(await page.locator(WD.next).first().isVisible().catch(() => false))) {
    // The Review page has "Submit" instead of "Save and Continue".
    const labels = await page.locator(WD.step).allInnerTexts().catch(() => [] as string[]);
    return labels.length ? labels[labels.length - 1].trim() : "loading";
  }
  const labels = await page.locator(WD.step).allInnerTexts().catch(() => [] as string[]);
  return labels.length ? labels[labels.length - 1].trim() : "Application"; // ["current step 1 of 5", "My Information"]
}

async function runWorkday(s: ApplySession, profile: Profile): Promise<void> {
  const run = await openTab(s, profile);
  const { page } = run;
  const started = Date.now();
  let lastFilled = "";
  let loginSince = 0;
  let seenForm = false;
  startWatching(s, page); // read back your answers on every page

  while (!stale(s) && !page.isClosed() && Date.now() - started < SESSION_MAX_MS) {
    if ((s.state as ApplyState) === "error") return;
    const step = await workdayStep(page);
    if (step !== "loading") seenForm = true;
    if (!seenForm && Date.now() - started > 90_000) {
      return fail(s, "No Workday application form appeared — the job may be closed. Open the job link to check.");
    }

    if (step === "signin") {
      loginSince ||= Date.now();
      if (Date.now() - loginSince > LOGIN_WAIT_MS) return fail(s, "Waited 15 minutes for the Workday sign-in — click Fill again when you're ready.");
      if (s.state !== "waiting") {
        s.state = "waiting";
        s.hint = `Sign in (or create your ${s.company} account) in the browser window. JARVIS never touches passwords — it continues by itself after you sign in.`;
        s.log.push("Waiting for you to sign in to Workday…");
        await page.bringToFront();
      }
    } else if (step === "loading") {
      // page in between → look again
    } else if (/^review$/i.test(step)) {
      if (s.step !== "Review") {
        s.step = "Review";
        s.state = "ready";
        s.finishedAt = new Date().toISOString();
        s.hint = "Review page: check everything, then YOU click Submit. Afterwards click ✅ I SUBMITTED IT here.";
        s.log.push("Reached Review — JARVIS stops here. Submit is yours.");
        markAnswersUsed(run.usedKeys);
        run.usedKeys = [];
      }
    } else if (step !== lastFilled) {
      loginSince = 0;
      lastFilled = step;
      s.step = step;
      s.state = "filling";
      s.hint = null;
      s.log.push(`Filling "${step}"…`);
      await page.waitForTimeout(1500); // let Workday finish drawing the page
      await page.evaluate(bannerScript("Check this page, then <b>you</b> click <b>Save and Continue</b>. JARVIS fills the next page."));
      const drafts = await fillPage(run);
      if (/experience/i.test(step)) {
        // Work history uses "Add" + date pickers — not automated yet, so tell you exactly what to enter.
        const job = profile.experience.find((e) => e.to === null) ?? profile.experience[0];
        if (job) add(s.needsYou, { question: "Work Experience", reason: `Click "Add" and enter: ${job.title} at ${job.company}, from ${job.from}${job.to ? ` to ${job.to}` : " (I currently work here)"}` });
      }
      await writeDrafts(run, drafts);
      if (stale(s) || (s.state as ApplyState) === "error") return;
      markAnswersUsed(run.usedKeys);
      run.usedKeys = [];
      s.state = "ready";
      s.finishedAt = new Date().toISOString();
      s.hint = `"${step}" is filled. Check it in the browser and click Save and Continue — JARVIS will fill the next page.`;
      s.log.push(`"${step}" done.`);
      await page.bringToFront();
    }
    await page.waitForTimeout(2000).catch(() => {});
  }
}

// ---------- filling one page (shared by all ATS) ----------
/** Adds an item, replacing an older one for the same question (you may visit a Workday page twice). */
function add(list: ApplyItem[], item: ApplyItem): void {
  const i = list.findIndex((x) => x.question === item.question);
  if (i >= 0) list[i] = item;
  else list.push(item);
}

async function readFields(run: Run): Promise<FormField[]> {
  const r = (await run.page.evaluate(`(${READ_FORM_FN})(${run.nextRef})`)) as { fields: FormField[]; next: number };
  run.nextRef = r.next;
  return r.fields;
}

const fieldId = (f: FormField) => `${f.kind}|${f.options?.[0]?.ref ?? f.ref}`;
// Choosing these can add/remove fields (country → state list, "Yes" → follow-up question) → re-read after.
const RESHAPES = new Set<FormField["kind"]>(["select", "listbox", "radio", "buttons", "checkbox", "multiselect"]);

/**
 * 📘 Dynamic forms: read → fill ONE field that can change the form → read again.
 * Refs stay the same between reads (see readForm.ts), so we know which fields are already handled.
 */
async function fillPage(run: Run): Promise<FormField[]> {
  const handled = new Set<string>();
  const drafts: FormField[] = [];
  for (let round = 0; round < 60; round++) {
    if (run.page.isClosed()) throw new ApplyError("The browser tab was closed.");
    const fields = await readFields(run);
    if (round === 0) run.s.log.push(`Found ${fields.length} fields.`);
    const todo = fields.filter((f) => !handled.has(fieldId(f)));
    if (todo.length === 0) break;
    // Resume first: Lever/Greenhouse read the PDF and pre-fill fields, which we then correct.
    todo.sort((a, b) => Number(b.kind === "file") - Number(a.kind === "file"));
    let reshaped = false;
    for (const field of todo) {
      handled.add(fieldId(field));
      const acted = await handleField(run, field, drafts);
      if (acted && (field.kind === "file" || RESHAPES.has(field.kind))) {
        reshaped = true;
        break;
      }
    }
    if (!reshaped) break;
  }
  return drafts;
}

/** Returns true if JARVIS changed something on the page. */
async function handleField(run: Run, field: FormField, drafts: FormField[]): Promise<boolean> {
  const { s, page } = run;
  const firstRef = field.options?.[0]?.ref ?? field.ref;
  if (stale(s)) return false; // "Fill again" started a new session → this old run stops touching things
  try {
    if (field.kind === "file") return await uploadResume(run, field);
    if (field.kind === "listbox" && !field.options?.length) field.options = await listboxOptions(page, field);

    const d = decide(field, run.facts, s.company, run.bank);
    const key = questionKey(field.question, s.company);
    if ((d.action === "ask" && !d.consent) || ((d.action === "fill" || d.action === "choose") && d.remembered)) {
      addLearnTarget(s.jobId, { key, question: field.question, kind: field.kind, ref: field.ref, options: field.options ?? [] });
    }

    if (d.action === "ignore") return false;
    if (d.action === "sensitive") {
      add(s.sensitive, { question: field.question });
      await mark(page, firstRef, "ask");
      return false;
    }
    if (d.action === "ask") {
      // Workday remembers your last application → a field may already hold YOUR earlier answer.
      if (field.current && !d.consent) {
        add(s.filled, { question: field.question, value: `${field.current} (already there)` });
        await mark(page, firstRef, "filled");
      } else {
        add(s.needsYou, { question: field.question, reason: d.reason });
        await mark(page, firstRef, "ask");
      }
      return false;
    }
    if (d.action === "draft") {
      if (field.current) {
        add(s.filled, { question: field.question, value: `${field.current.slice(0, 80)}… (already there)` });
        return false;
      }
      drafts.push(field);
      return false;
    }
    if (d.action === "upload") return false; // only file fields upload (handled above)
    const remembered = !!d.remembered;
    if (d.action === "fill") {
      if (await fillText(page, field, d.value)) {
        add(s.filled, { question: field.question, value: d.value, remembered });
        if (d.remembered) run.usedKeys.push(d.remembered);
        await mark(page, firstRef, "filled");
      } else {
        add(s.needsYou, { question: field.question, reason: `Type "${d.value}" and pick it from the list` });
        await mark(page, firstRef, "ask");
      }
      return true;
    }
    if (d.action === "choose") {
      // Already the right answer (Workday pre-selects "India", remembers your last application…)?
      if (field.current && (bestOption([{ label: field.current }], d.answer) || (field.kind === "multiselect" && field.current))) {
        add(s.filled, { question: field.question, value: field.current, remembered });
        await mark(page, firstRef, "filled");
        return false;
      }
      let picked = await choose(page, field, d.answer, d.option?.ref, d.option?.value);
      for (const alt of d.alternatives ?? []) picked ??= await choose(page, field, alt);
      for (const extra of d.more ?? []) await choose(page, field, extra.label, extra.ref); // "select all that apply"
      if (picked) {
        const all = [picked, ...(d.more ?? []).map((o) => o.label)].join(", ");
        add(s.filled, { question: field.question, value: all, remembered });
        if (d.remembered) run.usedKeys.push(d.remembered);
        await mark(page, firstRef, "filled");
      } else {
        add(s.needsYou, { question: field.question, reason: `Couldn't pick "${d.answer}"` });
        await mark(page, firstRef, "ask");
      }
      return true;
    }
    return false;
  } catch {
    await page.keyboard.press("Escape").catch(() => {}); // close any dropdown we left open
    add(s.needsYou, { question: field.question || "(unlabelled field)", reason: "Couldn't fill it automatically" });
    await mark(page, firstRef, "ask").catch(() => {});
    return false;
  }
}

/** Uploads resume.pdf under a proper name ("Nithin_Aluvala_Resume.pdf") — recruiters see the file name. */
async function uploadResume(run: Run, field: FormField): Promise<boolean> {
  const { s, page, profile } = run;
  if (decide(field, run.facts, s.company).action !== "upload") return false;
  if (!fs.existsSync(RESUME_PATH)) {
    add(s.needsYou, { question: "Resume", reason: "server/data/resume.pdf is missing" });
    return false;
  }
  // Workday keeps uploads on the page (you may come back with Back) → don't add a second copy.
  if (await page.locator('[data-automation-id="file-upload-item"]').first().isVisible().catch(() => false)) {
    s.resumeUploaded = true;
    return false;
  }
  const name = `${profile.name.trim().replace(/[^A-Za-z0-9]+/g, "_")}_Resume.pdf`;
  await page.locator(sel(field.ref)).setInputFiles({ name, mimeType: "application/pdf", buffer: fs.readFileSync(RESUME_PATH) });
  s.resumeUploaded = true;
  s.log.push("Resume attached.");
  await page.waitForTimeout(3000); // parsing / upload
  return true;
}

async function writeDrafts(run: Run, drafts: FormField[]): Promise<void> {
  const { s, page } = run;
  if (drafts.length === 0) return;
  s.state = "drafting";
  for (const [i, field] of drafts.entries()) {
    if (stale(s)) return;
    if (s.drafted.length >= MAX_DRAFTS) {
      add(s.needsYou, { question: field.question, reason: "Open question — write it yourself" });
      await mark(page, field.ref, "ask");
      continue;
    }
    s.log.push(`Drafting an answer (${i + 1}/${drafts.length}): "${field.question.slice(0, 60)}"…`);
    try {
      const answer = await draftAnswer(field.question, { title: s.title, company: s.company }, run.profile);
      const loc = page.locator(sel(field.ref));
      await loc.fill(answer);
      await loc.blur().catch(() => {});
      add(s.drafted, { question: field.question, value: answer });
      await mark(page, field.ref, "draft");
    } catch (err) {
      add(s.needsYou, { question: field.question, reason: `AI draft failed (${err instanceof Error ? err.message : err})` });
      await mark(page, field.ref, "ask");
    }
  }
}

// ---------- learning your answers (Step 3b) ----------
/**
 * 📘 LESSON: Learn from the human — with their confirmation
 * While the form is open, JARVIS READS (never types) the fields it left for you, every 2 s,
 * and keeps the latest values. They are saved to the answer bank only when you click
 * "I submitted it" — that click is your "yes, these answers are right".
 * Why read every few seconds instead of at the end? After you submit (or click Save and
 * Continue on Workday), the page changes and the values are gone. Frequent reads keep a fresh copy.
 */
type LearnTarget = { key: string; question: string; kind: FormField["kind"]; ref: string; options: { ref: string; label: string }[] };
type Watcher = { timer: NodeJS.Timeout | null; page: Page | null; targets: LearnTarget[]; captured: Map<string, { question: string; answer: string }> };
const watchers = new Map<number, Watcher>();
const WATCH_MAX_MS = 60 * 60_000; // stop reading after 1 hour

function watcherFor(jobId: number): Watcher {
  let w = watchers.get(jobId);
  if (!w) {
    w = { timer: null, page: null, targets: [], captured: new Map() };
    watchers.set(jobId, w);
  }
  return w;
}

function addLearnTarget(jobId: number, t: LearnTarget): void {
  const w = watcherFor(jobId);
  // Same question again (you came back to a page) → the NEW ref replaces the old one.
  w.targets = [...w.targets.filter((x) => x.key !== t.key), t];
}

function startWatching(s: ApplySession, page: Page): void {
  const w = watcherFor(s.jobId);
  if (w.timer) return;
  w.page = page;
  w.timer = setInterval(() => void readBack(s, w), 2000);
  setTimeout(() => watchers.get(s.jobId) === w && w.timer && clearInterval(w.timer), WATCH_MAX_MS).unref();
}

function stopWatching(jobId: number): void {
  const w = watchers.get(jobId);
  if (w?.timer) clearInterval(w.timer);
  watchers.delete(jobId);
}

async function readBack(s: ApplySession, w: Watcher): Promise<void> {
  if (!w.page || w.page.isClosed()) {
    if (w.timer) clearInterval(w.timer); // keep what we captured; stop reading
    return;
  }
  if (w.targets.length === 0) return;
  try {
    const targets = w.targets.map(({ key, kind, ref, options }) => ({ key, kind, ref, options }));
    const values = (await w.page.evaluate(`(${READ_VALUES_FN})(${JSON.stringify(targets)})`)) as Record<string, unknown>;
    // Only keys WE asked for, only strings — the page can't push anything else into your bank.
    for (const t of w.targets) {
      const v = values[t.key];
      if (typeof v === "string" && v.trim()) w.captured.set(t.key, { question: t.question, answer: v.trim().slice(0, 1000) });
    }
    s.learning = [...w.captured.values()].map((c) => ({ question: c.question, value: c.answer }));
  } catch {
    // the page navigated (e.g. after you clicked Submit) → keep the last good copy
  }
}

/** "I submitted it": save the answers you typed to the bank, mark the job applied. */
export async function finishApply(jobId: number): Promise<{ learned: ApplyItem[]; job: Job | undefined }> {
  const s = sessions.get(jobId);
  const w = watchers.get(jobId);
  if (w && s) await readBack(s, w); // one last fresh read, if the form is still open
  const learned = w ? [...w.captured.values()].map((c) => ({ question: c.question, value: c.answer })) : [];
  if (w) saveAnswers([...w.captured.entries()].map(([key, c]) => ({ key, question: c.question, answer: c.answer })));
  stopWatching(jobId);
  if (s) {
    s.done = true;
    s.hint = null;
    sessions.delete(jobId); // ends a Workday loop that is still following the tab
    sessions.set(jobId, { ...s });
  }
  return { learned, job: updateJobStatus(jobId, "applied") };
}

// ---------- typing and picking ----------
/** Returns false if the value didn't stick (so we report "needs you" instead of lying "filled"). */
async function fillText(page: Page, field: FormField, value: string): Promise<boolean> {
  const loc = page.locator(sel(field.ref));
  if (!field.autocomplete) {
    await loc.fill(value, { timeout: 5000 });
    await loc.blur().catch(() => {}); // Workday checks a field when you leave it
    return true;
  }
  // Autocomplete boxes (Lever "Current location") search on real KEY PRESSES and clear the text
  // unless you pick a suggestion — so type key by key, pick one, then CHECK it stuck.
  await loc.fill("", { timeout: 5000 });
  await loc.pressSequentially(value, { delay: 60 });
  await pickSuggestion(page, value);
  await page.waitForTimeout(500);
  return (await loc.inputValue()).trim().length > 0;
}

/** Click a suggestion in an open dropdown (never Enter — Enter can submit a form). */
async function pickSuggestion(page: Page, answer: string): Promise<string | null> {
  const options = page.locator("[role=option]:visible, .dropdown-location:visible, .dropdown-results > div:visible, .pac-item:visible");
  try {
    await options.first().waitFor({ timeout: 4000 });
  } catch {
    return null;
  }
  const texts = (await options.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const best = bestOption(texts.map((label, i) => ({ label, i })), answer);
  if (!best) return null;
  await options.nth(best.i).click({ timeout: 3000 });
  return texts[best.i];
}

// Workday: the list that opens under a dropdown button.
const WD_LIST_OPTIONS = 'ul[role="listbox"]:visible li[role="option"]';

async function openListbox(page: Page, field: FormField): Promise<Locator | null> {
  const btn = page.locator(sel(field.ref));
  if ((await btn.getAttribute("type")) !== "button") return null; // 🔒 never a submit button
  await btn.click({ timeout: 5000 });
  const options = page.locator(WD_LIST_OPTIONS);
  await options.first().waitFor({ timeout: 4000 });
  return options;
}

/** Opens a Workday dropdown just to READ its options, then closes it again. */
async function listboxOptions(page: Page, field: FormField): Promise<{ ref: string; label: string }[]> {
  const options = await openListbox(page, field);
  if (!options) return [];
  const texts = (await options.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  return texts.filter((t) => t && !/^select one$/i.test(t)).map((label) => ({ ref: field.ref, label }));
}

async function chooseListbox(page: Page, field: FormField, answer: string): Promise<string | null> {
  const options = await openListbox(page, field);
  if (!options) return null;
  const texts = (await options.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const best = bestOption(texts.map((label, i) => ({ label, i })).filter((o) => !/^select one$/i.test(o.label)), answer);
  if (!best) {
    await page.keyboard.press("Escape");
    return null;
  }
  await options.nth(best.i).click({ timeout: 3000 });
  await page.waitForTimeout(300);
  const shown = (await page.locator(sel(field.ref)).innerText()).replace(/\s+/g, " ").trim();
  return bestOption([{ label: shown }], texts[best.i]) ? texts[best.i] : null; // did it really change?
}

/**
 * Workday search box ("Field of Study", "How did you hear"): type → Enter (= search) → click a result.
 * Some lists are folders ("Job Board" → "LinkedIn"): after a click, if nothing got selected but new
 * options appeared, we pick again one level deeper.
 */
async function chooseMultiselect(page: Page, field: FormField, answer: string): Promise<string | null> {
  const input = page.locator(sel(field.ref));
  const box = input.locator('xpath=ancestor::*[@data-automation-id="multiSelectContainer"][1]');
  const pills = box.locator('[data-automation-id="selectedItem"]');
  const before = await pills.count();
  await input.click({ timeout: 5000 });
  await input.fill("");
  await input.pressSequentially(answer, { delay: 30 });
  // 🔒 The reader only tags inputs INSIDE a Workday search container, so this Enter means "search".
  await input.press("Enter");
  const options = page.locator('[data-automation-id="activeListContainer"]:visible [data-automation-id="promptOption"]');
  for (let level = 0; level < 2; level++) {
    try {
      await options.first().waitFor({ timeout: 5000 });
    } catch {
      break;
    }
    await page.waitForTimeout(400);
    const texts = (await options.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    const best = bestOption(texts.map((label, i) => ({ label, i })), answer);
    if (!best) break;
    await options.nth(best.i).click({ timeout: 3000 });
    await page.waitForTimeout(800);
    if ((await pills.count()) > before) {
      await page.keyboard.press("Escape").catch(() => {});
      return texts[best.i];
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  await input.fill("").catch(() => {});
  return null;
}

async function choose(page: Page, field: FormField, answer: string, optionRef?: string, optionValue?: string): Promise<string | null> {
  if (field.kind === "select" && optionValue) {
    await page.locator(sel(field.ref)).selectOption(optionValue, { timeout: 5000 });
    return answer;
  }
  if (field.kind === "listbox") return chooseListbox(page, field, answer);
  if (field.kind === "multiselect") return chooseMultiselect(page, field, answer);
  if (field.kind === "combobox") {
    const loc = page.locator(sel(field.ref));
    await loc.click({ timeout: 5000 });
    await loc.pressSequentially(answer, { delay: 30 });
    const picked = await pickSuggestion(page, answer);
    if (!picked) {
      await page.keyboard.press("Escape");
      await loc.fill("").catch(() => {});
    }
    return picked;
  }
  if (!optionRef) return null;
  const opt = page.locator(sel(optionRef));
  if (field.kind === "buttons") {
    // 🔒 Second safety check: only ever click a button that cannot submit the form.
    if ((await opt.getAttribute("type")) !== "button") return null;
    await opt.click({ timeout: 3000 });
  } else {
    // Styled radios/checkboxes hide the real <input>; "force" checks it anyway.
    await opt.check({ force: true, timeout: 3000 }).catch(() => opt.dispatchEvent("click"));
  }
  return answer;
}

// ---------- visual hints for your review ----------
function bannerScript(instruction: string): string {
  return String.raw`(() => {
  if (!document.getElementById("jarvis-style")) {
    const st = document.createElement("style");
    st.id = "jarvis-style";
    st.textContent = '[data-jarvis-state=filled]{outline:2px solid #22c55e!important;outline-offset:2px}' +
      '[data-jarvis-state=draft]{outline:2px solid #38bdf8!important;outline-offset:2px}' +
      '[data-jarvis-state=ask]{outline:2px dashed #f59e0b!important;outline-offset:2px}' +
      '#jarvis-banner{position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:320px;padding:12px 14px;border-radius:10px;' +
      'background:#0b1220;color:#e2e8f0;font:13px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4);border:1px solid #22d3ee;pointer-events:none}' +
      '#jarvis-banner b{color:#22d3ee}';
    document.head.appendChild(st);
  }
  let b = document.getElementById("jarvis-banner");
  if (!b) { b = document.createElement("div"); b.id = "jarvis-banner"; document.body.appendChild(b); }
  b.innerHTML = '<b>JARVIS filled this form.</b><br>' +
    '<span style="color:#22c55e">■</span> filled &nbsp; <span style="color:#38bdf8">■</span> AI draft — edit it &nbsp; <span style="color:#f59e0b">■</span> needs you<br>' +
    ${JSON.stringify(instruction)};
})()`;
}

function mark(page: Page, ref: string, state: "filled" | "draft" | "ask"): Promise<unknown> {
  // ref is always digits (from our own form reader), so it's safe to put in the script.
  if (!/^\d+$/.test(ref)) return Promise.resolve();
  return page.evaluate(`(() => {
    const el = document.querySelector('[data-jarvis="${ref}"]');
    if (!el) return;
    const hidden = el.type === "radio" || el.type === "checkbox" || el.type === "file";
    const combo = el.getAttribute("role") === "combobox" && el.closest("[class*=control]");
    const wdSearch = el.closest('[data-automation-id="multiSelectContainer"]');
    const target = hidden ? (el.closest("fieldset") || el.closest("label") || el.parentElement) : combo || wdSearch || el;
    target.setAttribute("data-jarvis-state", "${state}");
  })()`);
}
