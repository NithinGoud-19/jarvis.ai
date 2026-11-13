/**
 * The app "shell": navigation rail + top bar + the current page.
 *
 * Pages are switched with the URL hash (#/email, #/chat …) so a refresh keeps you on
 * the same page, and the browser Back button works.
 *
 * The Chat page stays MOUNTED (just hidden) when you visit other pages, so a reply that
 * is still streaming — or JARVIS talking — is not interrupted.
 */
import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { GmailStatus, Health, ServerEvent, VoiceStatus } from "./api";
import type { CoreState } from "./components/Core";
import { NavRail, type View } from "./components/NavRail";
import { ReminderAlerts, type ReminderAlert } from "./components/ReminderAlerts";
import { announce, onBlockedChange } from "./lib/announcer";
import { ActivityView } from "./views/ActivityView";
import { ChatView } from "./views/ChatView";
import { DashboardView } from "./views/DashboardView";
import { EmailView } from "./views/EmailView";
import { JobsView } from "./views/JobsView";
import { MemoryView } from "./views/MemoryView";
import { SettingsView } from "./views/SettingsView";
import { TasksView } from "./views/TasksView";

const VIEWS: View[] = ["dashboard", "chat", "tasks", "email", "jobs", "activity", "memory", "settings"];
const TITLES: Record<View, string> = {
  dashboard: "COMMAND CENTER",
  chat: "CONVERSATION",
  tasks: "TASKS & REMINDERS",
  email: "COMMUNICATIONS",
  jobs: "JOB OPERATIONS",
  activity: "ACTIVITY LOG",
  memory: "MEMORY CORE",
  settings: "SYSTEM SETTINGS",
};

const viewFromHash = (): View => {
  const v = window.location.hash.replace("#/", "") as View;
  return VIEWS.includes(v) ? v : "dashboard";
};

// Remember the 🔊 switch between visits (safe if storage is blocked)
const loadVoicePref = () => {
  try {
    return localStorage.getItem("jarvis.voiceReplies") !== "off";
  } catch {
    return true;
  }
};
const saveVoicePref = (on: boolean) => {
  try {
    localStorage.setItem("jarvis.voiceReplies", on ? "on" : "off");
  } catch {
    /* ignore */
  }
};

export default function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [health, setHealth] = useState<Health | null>(null);
  const [voice, setVoice] = useState<VoiceStatus | null>(null);
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [voiceReplies, setVoiceReplies] = useState(loadVoicePref);
  const [coreState, setCoreState] = useState<CoreState>("idle");
  const [command, setCommand] = useState<{ id: number; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [now, setNow] = useState(new Date());
  const [banner, setBanner] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [alerts, setAlerts] = useState<ReminderAlert[]>([]);

  // The event handler below is created ONCE, so it reads the latest voice settings through a ref
  // (📘 a ref = a box whose content can change without re-running effects)
  // (If the voice engine is missing, announce() just fails quietly → banner + Windows pop-up still show.)
  const speakRef = useRef(voiceReplies);
  speakRef.current = voiceReplies;
  const [soundBlocked, setSoundBlocked] = useState(false);
  useEffect(() => onBlockedChange(setSoundBlocked), []);

  const go = (v: View) => {
    window.location.hash = `/${v}`;
  };

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const refreshGmail = () => api.getGmailStatus().then(setGmail).catch(() => setGmail(null));

  useEffect(() => {
    const loadHealth = () => api.getHealth().then(setHealth).catch(() => setHealth(null));
    loadHealth();
    const t = setInterval(loadHealth, 30_000); // notice if Ollama stops/starts
    api.getVoiceStatus().then(setVoice).catch(() => setVoice(null));
    refreshGmail();

    // Coming back from Google's login page? The backend added ?gmail=... to the URL.
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail") === "connected") {
      setBanner({ type: "ok", text: `✉ Gmail connected: ${params.get("email")}` });
    } else if (params.get("gmail") === "error") {
      setBanner({ type: "error", text: `Gmail: ${params.get("message")}` });
    }
    if (params.has("gmail")) window.history.replaceState(null, "", "/#/settings");
    return () => clearInterval(t);
  }, []);

  // 📘 Live events from the server (Server-Sent Events). EventSource reconnects by itself
  // if the server restarts, so reminders keep arriving.
  useEffect(() => {
    const spoken = new Set<number>(); // reminders this tab already said out loud

    // Reminders that rang while this tab was closed (or the connection was down) → show + say them.
    const loadRinging = async () => {
      const ringing = await api.listRinging().catch(() => []);
      const alertsNow: ReminderAlert[] = ringing.map((t) => ({
        type: "reminder",
        task: { id: t.id, text: t.text, due_at: t.due_at },
        missed: Boolean(t.due_at && t.notified_at && api.sqliteDate(t.notified_at).getTime() - api.sqliteDate(t.due_at).getTime() > 120_000),
      }));
      setAlerts(alertsNow);
      const unspoken = ringing.filter((t) => !spoken.has(t.id));
      unspoken.forEach((t) => spoken.add(t.id));
      if (unspoken.length && speakRef.current) {
        const list = unspoken.map((t) => t.text).join(", and ");
        announce(unspoken.length === 1 ? `Sir, a reminder: ${list}` : `Sir, you have ${unspoken.length} reminders: ${list}`);
      }
    };

    const events = new EventSource("/api/events");
    // onopen runs on the first connect AND after every reconnect (e.g. the server restarted)
    events.onopen = () => void loadRinging();
    events.onmessage = (e) => {
      const event = JSON.parse(e.data) as ServerEvent;
      if (event.type === "reminder") {
        setAlerts((list) => [...list.filter((a) => a.task.id !== event.task.id), event]);
        if (!spoken.has(event.task.id) && speakRef.current) {
          announce(`${event.missed ? "Sir, you missed a reminder" : "Sir, a reminder"}: ${event.task.text}`);
        }
        spoken.add(event.task.id);
      }
      // Something changed (done in chat, dismissed in another tab…) → banners + lists reload
      if (event.type === "tasks-changed") void loadRinging();
      setRefreshKey((k) => k + 1);
    };
    return () => events.close();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  const online = Boolean(health?.ollamaRunning && health.modelInstalled);

  function runCommand(text: string) {
    setCommand({ id: Date.now(), text });
    go("chat");
  }

  async function removeGmail() {
    if (!confirm("Disconnect Gmail? JARVIS will no longer be able to read your emails.")) return;
    await api.disconnectGmail().catch(() => {});
    refreshGmail();
  }

  function toggleVoice() {
    const next = !voiceReplies;
    setVoiceReplies(next);
    saveVoicePref(next);
  }

  const dot = (on: boolean | undefined, label: string) => (
    <span className="flex items-center gap-1.5" title={`${label}: ${on ? "online" : "offline"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-slate-600"}`} />
      <span className={on ? "text-slate-300" : "text-slate-600"}>{label}</span>
    </span>
  );

  return (
    <div className="flex h-full">
      <NavRail view={view} onChange={go} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-4 border-b border-jarvis-cyan/10 bg-black/20 px-5 py-3">
          <div className="flex items-baseline gap-4">
            <h1 className="font-hud text-lg font-bold tracking-[0.45em] text-jarvis-cyan glow-text">J.A.R.V.I.S.</h1>
            <span className="hidden font-hud text-[10px] tracking-[0.3em] text-slate-500 sm:inline">{TITLES[view]}</span>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            {dot(online, "AI")}
            {dot(voice?.speechToText, "VOICE")}
            {dot(gmail?.connected, "GMAIL")}
            {voice?.textToSpeech && (
              <button
                onClick={toggleVoice}
                className={`rounded-full border px-2.5 py-0.5 ${voiceReplies ? "border-jarvis-cyan/50 text-jarvis-cyan" : "border-slate-600 text-slate-500"}`}
                title="Speak replies out loud"
              >
                {voiceReplies ? "🔊" : "🔇"}
              </button>
            )}
            <span className="hidden font-hud text-xs text-slate-400 md:inline">
              {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </header>

        {banner && (
          <div
            className={`flex items-center justify-between px-5 py-2 text-sm ${
              banner.type === "ok" ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"
            }`}
          >
            <span>{banner.text}</span>
            <button onClick={() => setBanner(null)} className="opacity-60 hover:opacity-100">
              ✕
            </button>
          </div>
        )}
        {soundBlocked && alerts.length > 0 && (
          <div className="px-5 pt-3 text-xs text-amber-300/80">🔊 Click anywhere on the page to hear your reminders (the browser blocks sound until you click once).</div>
        )}
        <ReminderAlerts alerts={alerts} onClose={(id) => setAlerts((list) => list.filter((a) => a.task.id !== id))} />
        {health && !online && (
          <div className="bg-amber-500/10 px-5 py-2 text-sm text-amber-300">
            ⚠ {health.ollamaRunning ? `Model ${health.model} is not downloaded.` : "Ollama is not running — open Ollama from the Start menu."}
          </div>
        )}

        {/* Pages */}
        <main className="min-h-0 flex-1 p-4 lg:p-5">
          <div className={view === "chat" ? "h-full" : "hidden"}>
            <ChatView
              online={online}
              voice={voice}
              voiceReplies={voiceReplies}
              command={command}
              onCommandTaken={() => setCommand(null)}
              onStateChange={setCoreState}
              onActivity={() => setRefreshKey((k) => k + 1)}
            />
          </div>
          {view === "dashboard" && (
            <DashboardView
              active
              coreState={online ? coreState : "offline"}
              gmail={gmail}
              refreshKey={refreshKey}
              onCommand={runCommand}
              onOpen={go}
            />
          )}
          {view === "tasks" && <TasksView active refreshKey={refreshKey} />}
          {view === "email" && <EmailView active gmail={gmail} onCommand={runCommand} onOpenSettings={() => go("settings")} />}
          {view === "jobs" && <JobsView active />}
          {view === "activity" && <ActivityView active refreshKey={refreshKey} />}
          {view === "memory" && <MemoryView active onChanged={() => setRefreshKey((k) => k + 1)} />}
          {view === "settings" && (
            <SettingsView
              health={health}
              voice={voice}
              gmail={gmail}
              voiceReplies={voiceReplies}
              onToggleVoice={toggleVoice}
              onDisconnectGmail={removeGmail}
            />
          )}
        </main>
      </div>
    </div>
  );
}
