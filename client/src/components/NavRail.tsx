export type View = "dashboard" | "chat" | "email" | "jobs" | "activity" | "memory" | "settings";

const ITEMS: { id: View; icon: string; label: string }[] = [
  { id: "dashboard", icon: "◉", label: "Dashboard" },
  { id: "chat", icon: "💬", label: "Chat" },
  { id: "email", icon: "✉", label: "Email" },
  { id: "jobs", icon: "💼", label: "Jobs" },
  { id: "activity", icon: "⚡", label: "Activity" },
  { id: "memory", icon: "🧠", label: "Memory" },
];

// Features that are planned but NOT built yet — shown honestly as "soon", not as fake pages
const SOON = [
  { icon: "📅", label: "Calendar" },
];

export function NavRail({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const item = (id: View, icon: string, label: string) => {
    const active = view === id;
    return (
      <button
        key={id}
        onClick={() => onChange(id)}
        className={`group relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm transition ${
          active ? "bg-jarvis-cyan/12 text-jarvis-cyan" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
        }`}
        title={label}
      >
        {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded bg-jarvis-cyan shadow-[0_0_8px_#22d3ee]" />}
        <span className="w-5 text-center text-base">{icon}</span>
        <span className="hidden lg:inline">{label}</span>
      </button>
    );
  };

  return (
    <nav className="flex w-16 shrink-0 flex-col gap-1 border-r border-jarvis-cyan/10 bg-black/30 px-2 py-4 lg:w-48">
      <div className="mb-6 flex items-center justify-center gap-2 lg:justify-start lg:px-3">
        <span className="h-3 w-3 rounded-full bg-jarvis-cyan shadow-[0_0_12px_#22d3ee]" />
        <span className="hidden font-hud text-sm tracking-[0.3em] text-jarvis-cyan glow-text lg:inline">JARVIS</span>
      </div>

      {ITEMS.map((i) => item(i.id, i.icon, i.label))}

      <div className="my-3 border-t border-jarvis-cyan/10" />
      {SOON.map((s) => (
        <div key={s.label} className="flex items-center gap-3 px-3 py-2 text-sm text-slate-600" title={`${s.label} — coming soon`}>
          <span className="w-5 text-center opacity-50">{s.icon}</span>
          <span className="hidden lg:inline">{s.label}</span>
          <span className="ml-auto hidden rounded border border-slate-700 px-1 text-[9px] tracking-wider lg:inline">SOON</span>
        </div>
      ))}

      <div className="mt-auto">{item("settings", "⚙", "Settings")}</div>
    </nav>
  );
}
