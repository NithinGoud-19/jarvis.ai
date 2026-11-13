import { useEffect, useState } from "react";
import * as api from "../api";
import type { Briefing } from "../api";
import { announce } from "../lib/announcer";

/** Dashboard card: today at a glance + ▶ "Brief me" (JARVIS reads it out loud). */
export function BriefingCard({ active, refreshKey, voiceOn }: { active: boolean; refreshKey: number; voiceOn: boolean }) {
  const [b, setB] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = () =>
    api
      .getBriefing()
      .then((data) => {
        setB(data);
        setError(null);
        return data;
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      });

  // When the Dashboard is shown, when tasks change, and every 10 minutes (weather, emails)
  useEffect(() => {
    if (!active) return;
    load();
    const t = setInterval(load, 10 * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, refreshKey]);

  async function play() {
    setLoading(true);
    const fresh = await load(); // always speak the latest numbers
    setLoading(false);
    if (!fresh) return;
    if (voiceOn) announce(fresh.speech);
    else setShowText(true); // voice is off → show the words instead
  }

  const chip = (icon: string, text: string, warn = false) => (
    <span
      className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${
        warn ? "border-amber-400/40 text-amber-300" : "border-jarvis-cyan/15 text-slate-300"
      }`}
    >
      <span>{icon}</span>
      {text}
    </span>
  );

  return (
    <div className="w-full max-w-md rounded-md border border-jarvis-cyan/20 bg-black/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-hud text-[10px] tracking-[0.25em] text-jarvis-cyan/80">DAILY BRIEFING</span>
        <button
          onClick={play}
          disabled={loading}
          className="rounded-full border border-jarvis-cyan/50 bg-jarvis-cyan/10 px-3 py-1 text-xs text-jarvis-cyan transition hover:bg-jarvis-cyan/25 disabled:opacity-50"
          title={voiceOn ? "JARVIS reads your briefing out loud" : "Voice is off: shows the briefing as text"}
        >
          {loading ? "…" : "▶ Brief me"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">⚠ {error}</p>}
      {!b && !error && <p className="mt-2 text-xs text-slate-500">Gathering intel…</p>}

      {b && (
        <>
          {b.weather && (
            <p className="mt-2 text-sm text-slate-200">
              {b.weather.icon} <b className="font-medium">{b.weather.temperature}°</b> {b.weather.sky}
              <span className="text-slate-500">
                {" "}
                · {b.weather.high}°/{b.weather.low}° · 💧{b.weather.rainChance}% · {b.weather.place.split(",")[0]}
              </span>
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chip("⏰", `${b.remindersToday.length} today`)}
            {b.waiting.length > 0 && chip("🔔", `${b.waiting.length} waiting`, true)}
            {chip("📋", `${b.todoCount} to-do`)}
            {b.email?.connected && chip("✉", `${b.email.unread}${b.email.more ? "+" : ""} unread`, b.email.important.length > 0)}
            {b.battery && chip(b.battery.charging ? "⚡" : "🔋", `${b.battery.percent}%`, !b.battery.charging && b.battery.percent < 30)}
          </div>
          {b.remindersToday.length > 0 && (
            <p className="mt-2 truncate text-xs text-slate-400" title={b.remindersToday.map((r) => `${r.time} ${r.text}`).join("\n")}>
              Next: <span className="text-slate-200">{b.remindersToday[0].text}</span> at {b.remindersToday[0].time}
            </p>
          )}
          {b.problems.length > 0 && <p className="mt-2 text-[11px] text-amber-300/70">Couldn't load: {b.problems.join(" · ")}</p>}
          <button onClick={() => setShowText((v) => !v)} className="mt-2 text-[11px] text-slate-500 hover:text-jarvis-cyan">
            {showText ? "Hide text ▲" : "Show text ▼"}
          </button>
          {showText && <p className="mt-1 text-xs leading-relaxed text-slate-300">{b.speech}</p>}
        </>
      )}
    </div>
  );
}
