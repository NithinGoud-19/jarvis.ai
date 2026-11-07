import { useEffect, useState, type FormEvent } from "react";
import * as api from "../api";
import type { Memory } from "../api";
import { Panel } from "../components/Panel";

/** View, add and delete the facts JARVIS remembers about you. */
export function MemoryView({ active, onChanged }: { active: boolean; onChanged: () => void }) {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => api.listMemories().then(setMemories).catch(() => setMemories([]));
  useEffect(() => {
    if (active) load();
  }, [active]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await api.addMemory(text.trim());
      setText("");
      setError(null);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(id: number) {
    await api.deleteMemory(id).catch((e) => setError(String(e)));
    load();
    onChanged();
  }

  return (
    <Panel title="MEMORY CORE" className="mx-auto h-full max-w-3xl">
      <p className="mb-4 text-sm text-slate-400">
        JARVIS uses these facts in <b>every</b> conversation. You can also say “Remember that …” in the chat.
      </p>
      <form onSubmit={add} className="mb-4 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="e.g. I'm a React developer looking for jobs in Hyderabad"
          className="flex-1 rounded-md border border-jarvis-cyan/30 bg-black/40 px-3 py-2 text-sm outline-none focus:border-jarvis-cyan"
        />
        <button
          disabled={!text.trim()}
          className="rounded-md bg-jarvis-cyan/20 px-4 font-hud text-xs tracking-widest text-jarvis-cyan hover:bg-jarvis-cyan/30 disabled:opacity-40"
        >
          ADD
        </button>
      </form>
      {error && <p className="mb-3 text-sm text-red-400">⚠ {error}</p>}

      <ul className="space-y-2 overflow-y-auto">
        {memories === null && <li className="text-xs text-slate-500">Loading…</li>}
        {memories?.length === 0 && <li className="text-sm text-slate-400">No memories yet.</li>}
        {memories?.map((m) => (
          <li
            key={m.id}
            className="group fade-up flex items-start gap-3 rounded-md border border-jarvis-cyan/10 bg-black/25 px-3 py-2.5"
          >
            <span className="mt-0.5 text-jarvis-cyan">◆</span>
            <div className="flex-1">
              <p className="text-sm text-slate-200">{m.content}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Saved {api.sqliteDate(m.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            <button
              onClick={() => remove(m.id)}
              className="text-xs text-slate-500 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
            >
              Forget
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
