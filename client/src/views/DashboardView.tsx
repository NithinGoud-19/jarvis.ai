import { useEffect, useState } from "react";
import * as api from "../api";
import type { EmailSummary, GmailStatus, Memory, Stats, SystemStats, ToolLog } from "../api";
import { Core, type CoreState } from "../components/Core";
import { Gauge } from "../components/Gauge";
import { Panel } from "../components/Panel";

type Props = {
  active: boolean;
  coreState: CoreState;
  gmail: GmailStatus | null;
  /** Bumped when something changes elsewhere (new chat, tool run…) → reload lists */
  refreshKey: number;
  onCommand: (text: string) => void;
  onOpen: (view: "email" | "activity" | "memory" | "settings") => void;
};

const QUICK = [
  { icon: "✉", text: "Summarize my unread emails" },
  { icon: "🔋", text: "What's my battery level?" },
  { icon: "💻", text: "Open VS Code" },
  { icon: "🎵", text: "Search YouTube for Iron Man songs" },
  { icon: "📂", text: "What's in my downloads folder?" },
  { icon: "⏰", text: "Remind me to drink water in 30 minutes" },
];

const TOOL_ICONS: Record<string, string> = {
  get_time: "🕒",
  get_system_info: "🖥",
  get_battery: "🔋",
  open_app: "🚀",
  open_website: "🌐",
  web_search: "🔎",
  list_folder: "📂",
  gmail_search: "✉",
  gmail_read: "📨",
  task_add: "⏰",
  tasks_list: "📋",
  task_complete: "✅",
  task_update: "✏",
  task_delete: "🗑",
};

function greeting(hour: number) {
  if (hour < 5) return "Working late, Sir";
  if (hour < 12) return "Good morning, Sir";
  if (hour < 17) return "Good afternoon, Sir";
  return "Good evening, Sir";
}

function timeAgo(date: Date) {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Short readable version of a tool call, e.g. "open_app · chrome" */
function describe(log: ToolLog) {
  const values = Object.values(log.args).filter((v) => v !== undefined && v !== "");
  return values.length ? values.join(" · ") : "";
}

export function DashboardView(props: Props) {
  const [now, setNow] = useState(new Date());
  const [system, setSystem] = useState<SystemStats | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [logs, setLogs] = useState<ToolLog[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [unread, setUnread] = useState<EmailSummary[] | null>(null);
  const [mailError, setMailError] = useState<string | null>(null);

  // Clock: every second (only while the dashboard is on screen)
  useEffect(() => {
    if (!props.active) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [props.active]);

  // System gauges: every 4 seconds while visible
  useEffect(() => {
    if (!props.active) return;
    const load = () => api.getSystem().then(setSystem).catch(() => setSystem(null));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [props.active]);

  // Stats + activity: when shown, and when something changed
  useEffect(() => {
    if (!props.active) return;
    api.getStats().then(setStats).catch(() => {});
    api.listToolLogs().then((l) => setLogs(l.slice(0, 7))).catch(() => {});
    api.listMemories().then((m) => setMemories(m.slice(-5).reverse())).catch(() => {});
  }, [props.active, props.refreshKey]);

  // Unread mail: when shown, then every 2 minutes
  useEffect(() => {
    if (!props.active || !props.gmail?.connected) return;
    const load = () =>
      api
        .listEmails("is:unread in:inbox", 5)
        .then((e) => {
          setUnread(e);
          setMailError(null);
        })
        .catch((e) => setMailError(e instanceof Error ? e.message : String(e)));
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [props.active, props.gmail?.connected]);

  const bat = system?.battery;

  return (
    <div className="grid h-full min-h-0 auto-rows-min gap-4 overflow-y-auto pb-2 xl:grid-cols-[1fr_1.3fr_1fr] xl:grid-rows-[auto_1fr]">
      {/* ── Left: System ───────────────────────────── */}
      <Panel title="SYSTEM STATUS" right={<span className="text-[10px] text-emerald-400">● LIVE</span>}>
        <div className="flex flex-wrap justify-around gap-4">
          <Gauge label="CPU" value={system?.cpuPercent ?? null} detail={system ? `${system.cpuCores} threads` : undefined} />
          <Gauge
            label="MEMORY"
            value={system?.ramPercent ?? null}
            detail={system ? `${system.ramUsedGB} / ${system.ramTotalGB} GB` : undefined}
          />
          <Gauge label="BATTERY" value={bat?.percent ?? null} detail={bat?.status} lowIsBad />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-jarvis-cyan/10 pt-3 text-xs">
          <dt className="text-slate-500">Processor</dt>
          <dd className="truncate text-right text-slate-300" title={system?.cpuModel}>
            {system?.cpuModel.replace(/ with .*/, "") ?? "—"}
          </dd>
          <dt className="text-slate-500">Uptime</dt>
          <dd className="text-right text-slate-300">{system ? `${system.uptimeHours} h` : "—"}</dd>
        </dl>
        {system && system.ramPercent >= 90 && (
          <p className="mt-3 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 text-xs text-amber-300">
            Memory is almost full, Sir. Closing some apps will make me faster.
          </p>
        )}
      </Panel>

      {/* ── Centre: Core + greeting ────────────────── */}
      <Panel className="xl:row-span-2" scan>
        <div className="flex h-full flex-col items-center justify-center gap-5 py-4">
          <div className="text-center">
            <p className="font-hud text-4xl tracking-[0.15em] text-white glow-text">
              {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              <span className="ml-1 text-lg text-jarvis-cyan/70">
                {String(now.getSeconds()).padStart(2, "0")}
              </span>
            </p>
            <p className="mt-1 text-xs tracking-[0.3em] text-slate-400">
              {now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase()}
            </p>
          </div>

          <Core state={props.coreState} size={210} />

          <p className="text-lg font-light text-slate-200">{greeting(now.getHours())}.</p>

          <div className="grid w-full max-w-md grid-cols-2 gap-2">
            {QUICK.map((q) => (
              <button
                key={q.text}
                onClick={() => props.onCommand(q.text)}
                className="flex items-center gap-2 rounded-md border border-jarvis-cyan/20 bg-black/30 px-3 py-2 text-left text-xs text-slate-300 transition hover:border-jarvis-cyan/60 hover:bg-jarvis-cyan/10 hover:text-white"
              >
                <span>{q.icon}</span>
                <span className="truncate">{q.text}</span>
              </button>
            ))}
          </div>
        </div>
      </Panel>

      {/* ── Right: Mail ────────────────────────────── */}
      <Panel
        title="INBOX"
        right={
          props.gmail?.connected ? (
            <button onClick={() => props.onOpen("email")} className="text-[11px] text-jarvis-cyan hover:underline">
              Open →
            </button>
          ) : null
        }
      >
        {!props.gmail ? (
          <p className="text-xs text-slate-500">Checking…</p>
        ) : !props.gmail.connected ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-slate-400">Gmail is not connected.</p>
            <button onClick={() => props.onOpen("settings")} className="text-xs text-jarvis-cyan hover:underline">
              Connect in Settings →
            </button>
          </div>
        ) : mailError ? (
          <p className="text-xs text-red-400">⚠ {mailError}</p>
        ) : unread === null ? (
          <p className="text-xs text-slate-500">Scanning inbox…</p>
        ) : (
          <>
            <p className="mb-3 flex items-baseline gap-2">
              <span className="font-hud text-3xl text-jarvis-cyan glow-text">{unread.length === 5 ? "5+" : unread.length}</span>
              <span className="text-xs tracking-widest text-slate-400">UNREAD</span>
            </p>
            <ul className="space-y-2">
              {unread.map((e) => (
                <li key={e.id} className="border-l-2 border-jarvis-cyan/30 pl-2.5">
                  <p className="truncate text-xs text-slate-400">
                    {e.important && <span className="mr-1 text-amber-300">★</span>}
                    {e.from.replace(/<.*>/, "").trim()}
                  </p>
                  <p className="truncate text-sm text-slate-200">{e.subject}</p>
                </li>
              ))}
              {unread.length === 0 && <li className="text-sm text-slate-400">Inbox zero. Well done, Sir. ✨</li>}
            </ul>
          </>
        )}
      </Panel>

      {/* ── Left bottom: Activity ──────────────────── */}
      <Panel
        title="RECENT ACTIVITY"
        right={
          <button onClick={() => props.onOpen("activity")} className="text-[11px] text-jarvis-cyan hover:underline">
            All →
          </button>
        }
      >
        {logs.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing yet. Ask me to do something!</p>
        ) : (
          <ul className="space-y-2">
            {logs.map((l) => (
              <li key={l.id} className="flex items-center gap-2 text-xs">
                <span className="w-5 text-center">{TOOL_ICONS[l.tool_name] ?? "⚙"}</span>
                <span className={l.ok ? "text-slate-300" : "text-red-300"}>{l.tool_name}</span>
                <span className="truncate text-slate-500">{describe(l)}</span>
                <span className="ml-auto shrink-0 text-slate-600">{timeAgo(api.sqliteDate(l.created_at))}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ── Right bottom: Stats ────────────────────── */}
      <Panel
        title="MEMORY CORE"
        right={
          <button onClick={() => props.onOpen("memory")} className="text-[11px] text-jarvis-cyan hover:underline">
            Manage →
          </button>
        }
      >
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["CHATS", stats?.conversations],
            ["MESSAGES", stats?.messages],
            ["MEMORIES", stats?.memories],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded border border-jarvis-cyan/10 bg-black/20 py-3">
              <p className="font-hud text-2xl text-jarvis-cyan">{value ?? "—"}</p>
              <p className="mt-1 text-[9px] tracking-[0.2em] text-slate-500">{label}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 mb-2 font-hud text-[10px] tracking-[0.25em] text-slate-500">I REMEMBER</p>
        {memories.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing yet. Say “Remember that …” in the chat.</p>
        ) : (
          <ul className="space-y-1.5">
            {memories.map((m) => (
              <li key={m.id} className="flex gap-2 text-sm text-slate-300">
                <span className="text-jarvis-cyan">◆</span>
                <span className="truncate">{m.content}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
