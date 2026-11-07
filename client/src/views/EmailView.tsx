import { useEffect, useState } from "react";
import * as api from "../api";
import type { Email, EmailSummary, GmailStatus } from "../api";
import { Panel } from "../components/Panel";

const FILTERS = [
  { label: "Inbox", q: "in:inbox" },
  { label: "Unread", q: "is:unread in:inbox" },
  { label: "Important", q: "is:important" },
  { label: "Today", q: "newer_than:1d" },
];

type Props = {
  active: boolean;
  gmail: GmailStatus | null;
  onCommand: (text: string) => void;
  onOpenSettings: () => void;
};

export function EmailView({ active, gmail, onCommand, onOpenSettings }: Props) {
  const [query, setQuery] = useState(FILTERS[0].q);
  const [search, setSearch] = useState("");
  const [emails, setEmails] = useState<EmailSummary[] | null>(null);
  const [selected, setSelected] = useState<Email | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !gmail?.connected) return;
    setEmails(null);
    setError(null);
    api
      .listEmails(query, 20)
      .then(setEmails)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [active, gmail?.connected, query]);

  async function open(id: string) {
    setLoadingId(id);
    try {
      setSelected(await api.getEmail(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingId(null);
    }
  }

  if (!gmail?.connected) {
    return (
      <Panel title="EMAIL" className="mx-auto mt-10 max-w-md">
        <div className="space-y-3 py-6 text-center">
          <p className="text-4xl">✉</p>
          <p className="text-sm text-slate-300">Gmail is not connected.</p>
          <button
            onClick={onOpenSettings}
            className="rounded-md border border-jarvis-cyan/40 px-4 py-2 text-sm text-jarvis-cyan hover:bg-jarvis-cyan/10"
          >
            Connect Gmail in Settings
          </button>
        </div>
      </Panel>
    );
  }

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(320px,1fr)_1.4fr]">
      <Panel
        title="INBOX"
        right={
          <button
            onClick={() => onCommand(`Summarize my emails matching "${query}"`)}
            className="rounded border border-jarvis-cyan/40 px-2 py-0.5 text-[11px] text-jarvis-cyan hover:bg-jarvis-cyan/10"
            title="Ask JARVIS to summarize this list"
          >
            ✨ Summarize
          </button>
        }
      >
        <div className="flex h-full flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.q}
                onClick={() => setQuery(f.q)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  query === f.q
                    ? "border-jarvis-cyan bg-jarvis-cyan/15 text-jarvis-cyan"
                    : "border-slate-700 text-slate-400 hover:border-slate-500"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (search.trim()) setQuery(search.trim());
            }}
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search: from:linkedin · subject:interview …"
              className="w-full rounded-md border border-jarvis-cyan/20 bg-black/40 px-3 py-2 text-sm outline-none focus:border-jarvis-cyan"
            />
          </form>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {error && <p className="text-sm text-red-400">⚠ {error}</p>}
            {!error && emails === null && <p className="text-xs text-slate-500">Loading…</p>}
            {emails?.length === 0 && <p className="text-sm text-slate-400">No emails found.</p>}
            <ul className="space-y-1">
              {emails?.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => open(e.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition ${
                      selected?.id === e.id
                        ? "border-jarvis-cyan/50 bg-jarvis-cyan/10"
                        : "border-transparent hover:border-jarvis-cyan/20 hover:bg-white/5"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs">
                      {e.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-jarvis-cyan shadow-[0_0_6px_#22d3ee]" />}
                      {e.important && <span className="text-amber-300">★</span>}
                      <span className={`truncate ${e.unread ? "text-white" : "text-slate-400"}`}>
                        {e.from.replace(/<.*>/, "").trim() || e.from}
                      </span>
                      <span className="ml-auto shrink-0 text-slate-500">{loadingId === e.id ? "…" : e.date}</span>
                    </div>
                    <p className={`mt-0.5 truncate text-sm ${e.unread ? "font-medium text-slate-100" : "text-slate-300"}`}>
                      {e.subject}
                    </p>
                    <p className="truncate text-xs text-slate-500">{e.snippet}</p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel
        title="READER"
        right={
          selected && (
            <button
              onClick={() => onCommand(`Read email ${selected.id} and summarize it in 3 short points.`)}
              className="rounded border border-jarvis-cyan/40 px-2 py-0.5 text-[11px] text-jarvis-cyan hover:bg-jarvis-cyan/10"
            >
              ✨ Summarize this
            </button>
          )
        }
      >
        {!selected ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Select an email to read it.</div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="border-b border-jarvis-cyan/10 pb-3">
              <h3 className="text-lg text-white">{selected.subject}</h3>
              <p className="mt-1 text-xs text-slate-400">
                {selected.from} · {selected.date}
              </p>
            </div>
            {/* React escapes text, so email HTML/scripts can never run here */}
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
              {selected.body || selected.snippet}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
