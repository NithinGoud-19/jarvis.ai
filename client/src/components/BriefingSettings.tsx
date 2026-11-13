import { useEffect, useState, type FormEvent } from "react";
import * as api from "../api";
import type { BriefingSettings as Settings } from "../api";
import { Panel } from "./Panel";

/** Settings page section: weather city + "read it automatically each morning". */
export function BriefingSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [city, setCity] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getBriefingSettings()
      .then((data) => {
        setS(data);
        setCity(data.city);
      })
      .catch((e) => setMsg({ ok: false, text: String(e) }));
  }, []);

  async function save(changes: { city?: string; autoplay?: boolean }) {
    setSaving(true);
    try {
      const data = await api.saveBriefingSettings(changes);
      setS(data);
      setCity(data.city);
      setMsg({ ok: true, text: changes.city ? `Weather location: ${data.place?.name ?? data.city}` : "Saved" });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setSaving(false);
  }

  const submitCity = (e: FormEvent) => {
    e.preventDefault();
    if (city.trim() && city.trim() !== s?.city) save({ city: city.trim() });
  };

  return (
    <Panel title="MORNING BRIEFING" className="md:col-span-2">
      {!s ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-4">
          <form onSubmit={submitCity} className="flex flex-wrap items-center gap-2">
            <label className="w-40 text-sm text-slate-400" htmlFor="briefing-city">
              Weather city
            </label>
            <input
              id="briefing-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              maxLength={80}
              className="min-w-40 flex-1 rounded-md border border-jarvis-cyan/30 bg-black/40 px-3 py-1.5 text-sm outline-none focus:border-jarvis-cyan"
            />
            <button
              disabled={saving || !city.trim() || city.trim() === s.city}
              className="rounded-md bg-jarvis-cyan/20 px-4 py-1.5 font-hud text-xs tracking-widest text-jarvis-cyan hover:bg-jarvis-cyan/30 disabled:opacity-40"
            >
              {saving ? "…" : "SAVE"}
            </button>
          </form>
          {s.place && <p className="-mt-2 pl-0 text-xs text-slate-500 md:pl-42">📍 {s.place.name}</p>}

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-slate-400">
              Read it out loud automatically
              <span className="block text-xs text-slate-500">The first time you open JARVIS each morning (5 AM – noon), once a day</span>
            </span>
            <button
              onClick={() => save({ autoplay: !s.autoplay })}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${s.autoplay ? "bg-jarvis-cyan/70" : "bg-slate-700"}`}
              aria-label="Toggle automatic morning briefing"
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s.autoplay ? "left-5.5" : "left-0.5"}`} />
            </button>
          </div>
          {msg && <p className={`text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.ok ? "✓" : "⚠"} {msg.text}</p>}
        </div>
      )}
    </Panel>
  );
}
