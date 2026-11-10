import { useEffect, useState, type FormEvent } from "react";
import * as api from "../api";
import type { AiReview, Company, Job, JobSearchResult, JobStatus } from "../api";
import { Panel } from "../components/Panel";

const STATUSES: JobStatus[] = ["new", "saved", "applied", "interview", "offer", "rejected", "ignored"];
const STATUS_STYLE: Record<JobStatus, string> = {
  new: "border-jarvis-cyan/40 text-jarvis-cyan",
  saved: "border-sky-400/40 text-sky-300",
  applied: "border-violet-400/40 text-violet-300",
  interview: "border-amber-400/50 text-amber-300",
  offer: "border-emerald-400/50 text-emerald-300",
  rejected: "border-red-400/40 text-red-300",
  ignored: "border-slate-600 text-slate-500",
};

const input =
  "rounded-md border border-jarvis-cyan/30 bg-black/40 px-3 py-2 text-sm outline-none focus:border-jarvis-cyan";
const button =
  "rounded-md bg-jarvis-cyan/20 px-4 py-2 font-hud text-xs tracking-widest text-jarvis-cyan hover:bg-jarvis-cyan/30 disabled:opacity-40";

/** Live job search on company career pages + a simple application tracker. */
export function JobsView({ active }: { active: boolean }) {
  const [role, setRole] = useState("fullstack developer");
  const [location, setLocation] = useState("India");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<JobSearchResult | null>(null);

  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<JobStatus | "all">("all");
  const [text, setText] = useState("");
  const [sort, setSort] = useState<"score" | "recent">("score");
  const [openId, setOpenId] = useState<number | null>(null);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [showCompanies, setShowCompanies] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [companyMsg, setCompanyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .listJobs(filter === "all" ? undefined : filter, text.trim() || undefined, sort)
      .then(setJobs)
      .catch((e) => setError(String(e)));
    api.getJobCounts().then(setCounts).catch(() => {});
  };
  const loadCompanies = () => api.listCompanies().then(setCompanies).catch(() => {});

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(load, 200); // small delay so typing in the filter box doesn't spam the server
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, filter, text, sort]);
  useEffect(() => {
    if (active) loadCompanies();
  }, [active]);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (role.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      setResult(await api.searchJobs(role.trim(), location.trim() || "India"));
      setFilter("all");
      setText("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function changeStatus(job: Job, status: JobStatus) {
    try {
      const updated = await api.setJobStatus(job.id, status);
      setJobs((list) => (list ?? []).map((j) => (j.id === job.id ? updated : j)));
      api.getJobCounts().then(setCounts).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function addCompany(e: FormEvent) {
    e.preventDefault();
    setCompanyMsg(null);
    try {
      const c = await api.addCompany(newName.trim(), newUrl.trim());
      setCompanyMsg({ ok: true, text: `✓ ${c.name} added (${c.liveJobs} live jobs right now).` });
      setNewName("");
      setNewUrl("");
      loadCompanies();
    } catch (err) {
      setCompanyMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  }

  async function removeCompany(c: Company) {
    if (!confirm(`Stop checking ${c.name}? Its saved jobs will be removed too.`)) return;
    await api.deleteCompany(c.id).catch((e) => setError(String(e)));
    loadCompanies();
    load();
  }

  const total = Object.entries(counts).reduce((n, [s, c]) => (s === "ignored" ? n : n + c), 0);
  const tab = (id: JobStatus | "all", label: string, n: number | undefined) => (
    <button
      key={id}
      onClick={() => setFilter(id)}
      className={`rounded-full border px-3 py-1 text-[11px] capitalize transition ${
        filter === id ? "border-jarvis-cyan bg-jarvis-cyan/15 text-jarvis-cyan" : "border-slate-700 text-slate-400 hover:text-slate-200"
      }`}
    >
      {label} <span className="opacity-60">{n ?? 0}</span>
    </button>
  );

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4">
      {/* Live search */}
      <Panel title="LIVE JOB SEARCH" scan={searching}>
        <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row">
          <input value={role} onChange={(e) => setRole(e.target.value)} maxLength={80} placeholder="Role, e.g. fullstack developer" className={`${input} flex-1`} />
          <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={40} placeholder="India / city / remote / any" className={`${input} sm:w-40`} />
          <button disabled={searching || role.trim().length < 2} className={button}>
            {searching ? "SCANNING…" : "SEARCH"}
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          {searching
            ? `Checking ${companies.filter((c) => c.enabled).length} company career pages live…`
            : result
              ? `Checked ${result.companiesSearched - result.failed.length}/${result.companiesSearched} career pages in ${(result.ms / 1000).toFixed(1)} s → ${result.jobs.length} matching jobs, ${result.newCount} new.` +
                (result.failed.length ? ` Unreachable: ${result.failed.map((f) => f.company).join(", ")}.` : "")
              : "Tip: you can also ask in chat — “find me fullstack developer roles in Hyderabad”."}
          {" "}
          <button onClick={() => setShowCompanies((s) => !s)} className="text-jarvis-cyan hover:underline">
            {showCompanies ? "Hide companies" : `Companies (${companies.length})`}
          </button>
          {" · "}
          <button onClick={() => setShowAnswers((s) => !s)} className="text-jarvis-cyan hover:underline">
            {showAnswers ? "Hide saved answers" : "Saved answers"}
          </button>
        </p>
        {showAnswers && <SavedAnswersPanel />}
        {error && <p className="mt-2 text-sm text-red-400">⚠ {error}</p>}

        {showCompanies && (
          <div className="mt-3 border-t border-jarvis-cyan/10 pt-3">
            <form onSubmit={addCompany} className="mb-2 flex flex-col gap-2 sm:flex-row">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} placeholder="Company name" className={`${input} sm:w-44`} />
              <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} maxLength={300} placeholder="Careers link, e.g. https://jobs.lever.co/meesho" className={`${input} flex-1`} />
              <button disabled={!newName.trim() || !newUrl.trim()} className={button}>
                ADD
              </button>
            </form>
            <p className="mb-2 text-[11px] text-slate-500">
              Works with careers pages hosted on Greenhouse, Lever, Ashby, SmartRecruiters or Workday (look at the link of a job's “Apply” page).
            </p>
            {companyMsg && <p className={`mb-2 text-xs ${companyMsg.ok ? "text-emerald-300" : "text-red-400"}`}>{companyMsg.text}</p>}
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {companies.map((c) => (
                <span key={c.id} className="group inline-flex items-center gap-1.5 rounded border border-jarvis-cyan/15 bg-black/30 px-2 py-0.5 text-[11px] text-slate-300">
                  {c.name}
                  <span className="text-[9px] uppercase text-slate-500">{c.ats}</span>
                  <button onClick={() => removeCompany(c)} className="text-slate-600 hover:text-red-400" title={`Remove ${c.name}`}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {/* Tracker */}
      <Panel title="JOB TRACKER" className="min-h-0 flex-1">
        <div className="flex h-full min-h-0 flex-col">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {tab("all", "All", total)}
            {STATUSES.map((s) => tab(s, s, counts[s]))}
            <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as "score" | "recent")}
                className="rounded-md border border-jarvis-cyan/30 bg-black/40 px-2 py-1 text-xs outline-none"
                title="Sort jobs"
              >
                <option value="score" className="bg-slate-900">Best match</option>
                <option value="recent" className="bg-slate-900">Recently seen</option>
              </select>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter…" className={`${input} w-full py-1 text-xs sm:w-40`} />
            </div>
          </div>

          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {jobs === null && <li className="text-xs text-slate-500">Loading…</li>}
            {jobs?.length === 0 && (
              <li className="text-sm text-slate-400">
                {filter === "all" && !text ? "No jobs yet — run a search above." : "Nothing here."}
              </li>
            )}
            {jobs?.map((j) => (
              <li key={j.id} className="fade-up rounded-md border border-jarvis-cyan/10 bg-black/25 px-3 py-2.5">
               <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <ScoreBadge job={j} open={openId === j.id} onClick={() => setOpenId(openId === j.id ? null : j.id)} />
                <div className="min-w-0 flex-1">
                  <a href={j.url} target="_blank" rel="noreferrer" className="text-sm text-slate-100 hover:text-jarvis-cyan hover:underline">
                    {j.title}
                  </a>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    <span className="text-slate-300">{j.company}</span> · {j.location} · found{" "}
                    {api.sqliteDate(j.first_seen_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · #{j.id}
                  </p>
                </div>
                <select
                  value={j.status}
                  onChange={(e) => changeStatus(j, e.target.value as JobStatus)}
                  className={`rounded-full border bg-black/40 px-2 py-0.5 text-[11px] capitalize outline-none ${STATUS_STYLE[j.status]}`}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s} className="bg-slate-900 text-slate-200">
                      {s}
                    </option>
                  ))}
                </select>
               </div>
                {openId === j.id && (
                  <>
                    <MatchPanel job={j} onReviewed={(review) => setJobs((list) => (list ?? []).map((x) => (x.id === j.id ? { ...x, ai_review: review } : x)))} />
                    <ApplyPanel
                      job={j}
                      onApplied={(updated) => {
                        setJobs((list) => (list ?? []).map((x) => (x.id === updated.id ? updated : x)));
                        api.getJobCounts().then(setCounts).catch(() => {});
                      }}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Panel>
    </div>
  );
}

// ---------- match score UI ----------

const scoreColor = (s: number) =>
  s >= 65 ? "border-emerald-400/60 text-emerald-300" : s >= 45 ? "border-amber-400/60 text-amber-300" : "border-red-400/50 text-red-300";

/** The round score on the left of each job — click to see why. */
function ScoreBadge({ job, open, onClick }: { job: Job; open: boolean; onClick: () => void }) {
  if (job.match_score === null) {
    // Still a button: the panel also holds "Fill application", which unscored jobs need too.
    return (
      <button
        onClick={onClick}
        title="Not scored yet — click for actions"
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-slate-600/50 text-sm text-slate-500 transition hover:scale-105 ${open ? "bg-white/5" : ""}`}
      >
        —
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      title="Match with your profile — click for details"
      className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-full border-2 font-hud text-sm leading-none transition hover:scale-105 ${scoreColor(job.match_score)} ${open ? "bg-white/5" : ""}`}
    >
      {job.match_score}
      <span className="mt-0.5 text-[7px] tracking-wider opacity-70">MATCH</span>
    </button>
  );
}

const VERDICT_STYLE: Record<AiReview["verdict"], string> = {
  strong: "text-emerald-300 border-emerald-400/50",
  possible: "text-amber-300 border-amber-400/50",
  weak: "text-red-300 border-red-400/50",
};

/** Why this score: skills you have / miss, years asked, and the optional AI review. */
function MatchPanel({ job, onReviewed }: { job: Job; onReviewed: (r: AiReview) => void }) {
  const [reviewing, setReviewing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const d = job.match_details;
  const review = job.ai_review;

  useEffect(() => {
    if (!reviewing) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [reviewing]);

  async function runReview() {
    setReviewing(true);
    setSeconds(0);
    setError(null);
    try {
      onReviewed(await api.reviewJob(job.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewing(false);
    }
  }

  const chips = (items: string[], cls: string) =>
    items.map((s) => (
      <span key={s} className={`rounded border px-1.5 py-0.5 text-[10px] ${cls}`}>
        {s}
      </span>
    ));

  return (
    <div className="fade-up mt-3 space-y-3 border-t border-jarvis-cyan/10 pt-3 text-xs">
      {d && (
        <>
          <ul className="space-y-0.5 text-slate-300">
            {d.reasons.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>
          {d.have.length > 0 && <div className="flex flex-wrap items-center gap-1"><span className="mr-1 text-slate-500">You have:</span>{chips(d.have, "border-emerald-400/30 text-emerald-300")}</div>}
          {d.missing.length > 0 && <div className="flex flex-wrap items-center gap-1"><span className="mr-1 text-slate-500">Missing:</span>{chips(d.missing, "border-red-400/30 text-red-300")}</div>}
        </>
      )}

      {review ? (
        <div className="rounded-md border border-jarvis-cyan/15 bg-black/30 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-hud text-[10px] tracking-widest text-jarvis-cyan">AI REVIEW</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${VERDICT_STYLE[review.verdict]}`}>{review.verdict} fit</span>
            <button onClick={runReview} disabled={reviewing} className="ml-auto text-[10px] text-slate-500 hover:text-jarvis-cyan disabled:opacity-40">
              {reviewing ? `Thinking… ${seconds}s` : "↻ Redo"}
            </button>
          </div>
          <p className="mb-2 text-slate-200">{review.summary}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {([
              ["✓ Matches", review.matching, "text-emerald-300"],
              ["✕ Gaps", review.gaps, "text-red-300"],
              ["➜ Tips", review.tips, "text-sky-300"],
            ] as const).map(([title, items, cls]) => (
              <div key={title}>
                <p className={`mb-1 font-semibold ${cls}`}>{title}</p>
                <ul className="space-y-1 text-slate-300">
                  {items.map((x) => (
                    <li key={x}>• {x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button onClick={runReview} disabled={reviewing || !job.has_description} className={button}>
            {reviewing ? `AI IS READING… ${seconds}s` : "🧠 AI REVIEW"}
          </button>
          <span className="text-[11px] text-slate-500">
            {job.has_description ? "JARVIS reads the full job and compares it with your profile (~1–2 min on this laptop)." : "No description available for this job."}
          </span>
        </div>
      )}
      {error && <p className="text-red-400">⚠ {error}</p>}
    </div>
  );
}

// ---------- answer bank UI ----------

/** What JARVIS learned from your past applications — edit or delete anything. */
function SavedAnswersPanel() {
  const [items, setItems] = useState<api.SavedAnswer[] | null>(null);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => api.listSavedAnswers().then(setItems).catch((e) => setError(String(e)));
  useEffect(() => {
    reload();
  }, []);

  async function save() {
    if (!editing) return;
    try {
      await api.updateSavedAnswer(editing.id, editing.text);
      setEditing(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  async function remove(a: api.SavedAnswer) {
    if (!confirm(`Forget your answer to “${a.question}”?`)) return;
    await api.deleteSavedAnswer(a.id).catch((e) => setError(String(e)));
    reload();
  }

  return (
    <div className="mt-3 border-t border-jarvis-cyan/10 pt-3 text-xs">
      <p className="mb-2 text-[11px] text-slate-500">
        Answers you gave on past applications. JARVIS reuses them when the same question comes up (even at another company).
      </p>
      {error && <p className="mb-2 text-red-400">⚠ {error}</p>}
      {items?.length === 0 && <p className="text-slate-400">Nothing saved yet — answer the orange questions on a form, then click “I submitted it”.</p>}
      <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {items?.map((a) => (
          <li key={a.id} className="flex items-start gap-2 rounded border border-jarvis-cyan/10 bg-black/25 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-slate-300">{a.question}</p>
              {editing?.id === a.id ? (
                <div className="mt-1 flex gap-2">
                  <input value={editing.text} onChange={(e) => setEditing({ id: a.id, text: e.target.value })} maxLength={1000} className={`${input} flex-1 py-1 text-xs`} />
                  <button onClick={save} disabled={!editing.text.trim()} className="text-jarvis-cyan hover:underline disabled:opacity-40">Save</button>
                  <button onClick={() => setEditing(null)} className="text-slate-500 hover:underline">Cancel</button>
                </div>
              ) : (
                <p className="mt-0.5 text-emerald-300">
                  → {a.answer} <span className="text-[10px] text-slate-600">· used {a.uses}×</span>
                </p>
              )}
            </div>
            {editing?.id !== a.id && (
              <>
                <button onClick={() => setEditing({ id: a.id, text: a.answer })} className="text-slate-500 hover:text-jarvis-cyan" title="Edit">✎</button>
                <button onClick={() => remove(a)} className="text-slate-600 hover:text-red-400" title="Forget">✕</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- apply (form-filler) UI ----------

const BUSY: api.ApplySession["state"][] = ["opening", "filling", "drafting"];
const STATE_TEXT: Record<api.ApplySession["state"], string> = {
  opening: "Opening the form…",
  filling: "Filling fields…",
  drafting: "AI is drafting answers…",
  ready: "Filled — your turn in the browser",
  error: "Stopped",
};

/**
 * 📘 POLLING: the server fills the form in the background. While it's busy we ask
 * "how is it going?" every 2 seconds and show the latest session.
 */
function ApplyPanel({ job, onApplied }: { job: Job; onApplied: (job: Job) => void }) {
  const [session, setSession] = useState<api.ApplySession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [learned, setLearned] = useState<api.ApplyItem[] | null>(null);
  const busy = !!session && BUSY.includes(session.state);
  // While the filled form is open, keep refreshing so you can see what JARVIS will remember.
  const watching = !!session && session.state === "ready" && !session.done;

  useEffect(() => {
    if (!watching) return;
    const t = setInterval(() => api.getApplySession(job.id).then(setSession).catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [watching, job.id]);

  async function submitted() {
    setError(null);
    try {
      const r = await api.finishApply(job.id);
      setLearned(r.learned);
      setSession((s) => (s ? { ...s, done: true } : s));
      onApplied(r.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    api.getApplySession(job.id).then(setSession).catch(() => {});
  }, [job.id]);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => api.getApplySession(job.id).then(setSession).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [busy, job.id]);

  async function start() {
    setError(null);
    try {
      setSession(await api.startApply(job.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const list = (title: string, items: api.ApplyItem[], cls: string, show: (i: api.ApplyItem) => string | undefined) =>
    items.length > 0 && (
      <div>
        <p className={`mb-1 font-semibold ${cls}`}>
          {title} ({items.length})
        </p>
        <ul className="space-y-1 text-slate-300">
          {items.map((i, n) => (
            <li key={n}>
              • {i.question}
              {show(i) && <span className="text-slate-500"> — {show(i)}</span>}
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="fade-up mt-3 space-y-3 border-t border-jarvis-cyan/10 pt-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-hud text-[10px] tracking-widest text-jarvis-cyan">APPLY</span>
        {!busy && (
          <button onClick={start} className={button}>
            {session ? "↻ FILL AGAIN" : "📝 FILL APPLICATION"}
          </button>
        )}
        {session?.state === "ready" && !session.done && (
          <button onClick={submitted} className={`${button} border-emerald-400/50 text-emerald-300`}>
            ✅ I SUBMITTED IT
          </button>
        )}
        <span className="text-[11px] text-slate-500">
          {session
            ? `${STATE_TEXT[session.state]}${busy ? ` · ${session.log.at(-1) ?? ""}` : ""}`
            : "JARVIS opens the form in Edge, fills it and uploads your resume. It never submits — you do."}
        </span>
      </div>

      {session?.error && <p className="text-red-400">⚠ {session.error}</p>}
      {error && <p className="text-red-400">⚠ {error}</p>}
      {learned && (
        <p className="text-emerald-300">
          ✓ Marked as applied.{" "}
          {learned.length
            ? `JARVIS remembered ${learned.length} answer${learned.length > 1 ? "s" : ""} for next time: ${learned.map((l) => `“${l.question.slice(0, 40)}” → ${l.value}`).join("; ")}`
            : "No new answers to remember."}
        </p>
      )}

      {session && !busy && session.state === "ready" && !session.done && (
        <div className="rounded-md border border-jarvis-cyan/15 bg-black/30 p-3">
          <p className="mb-2 text-slate-200">
            Filled <b className="text-emerald-300">{session.filled.length}</b> fields
            {session.resumeUploaded ? " · resume attached" : ""}
            {session.drafted.length ? ` · ${session.drafted.length} AI drafts` : ""}. Check everything in the browser, then click Submit there.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {list("⚠ Needs you", session.needsYou, "text-amber-300", (i) => i.reason)}
            {list("✎ AI drafts — edit them", session.drafted, "text-sky-300", (i) => i.value)}
            {list("⊘ Left for you (personal)", session.sensitive, "text-slate-400", () => undefined)}
            {list("✓ Filled", session.filled, "text-emerald-300", (i) => (i.remembered ? `${i.value} (remembered)` : i.value))}
          </div>
          {(session.learning.length > 0 || session.needsYou.length > 0) && <p className="mt-3 text-[11px] text-slate-500">
            {session.learning.length
              ? `💾 Will remember when you click “I submitted it”: ${session.learning.map((l) => `“${l.question.slice(0, 40)}” → ${l.value}`).join("; ")}`
              : "💾 Answer the orange questions in the browser — JARVIS will remember them for next time (not personal or consent ones)."}
          </p>}
        </div>
      )}
    </div>
  );
}
