import { Fragment, useEffect, useState } from "react";
import * as api from "../api";
import type { ToolLog } from "../api";
import { Panel } from "../components/Panel";

/** The audit log: everything JARVIS did, newest first. */
export function ActivityView({ active, refreshKey }: { active: boolean; refreshKey: number }) {
  const [logs, setLogs] = useState<ToolLog[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "ok" | "failed">("all");

  const load = () => api.listToolLogs().then(setLogs).catch(() => setLogs([]));
  useEffect(() => {
    if (active) load();
  }, [active, refreshKey]);

  const shown = (logs ?? []).filter((l) => filter === "all" || (filter === "ok" ? l.ok : !l.ok));
  const failed = (logs ?? []).filter((l) => !l.ok).length;

  return (
    <Panel
      title="ACTIVITY LOG"
      className="h-full"
      right={
        <div className="flex items-center gap-2 text-[11px]">
          {(["all", "ok", "failed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-0.5 ${filter === f ? "bg-jarvis-cyan/15 text-jarvis-cyan" : "text-slate-400 hover:text-slate-200"}`}
            >
              {f === "all" ? `All (${logs?.length ?? 0})` : f === "ok" ? "Success" : `Failed (${failed})`}
            </button>
          ))}
          <button onClick={load} className="ml-2 text-jarvis-cyan hover:underline">
            ↻ Refresh
          </button>
        </div>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        Every tool JARVIS used — the audit log from Phase 5. Click a row to see the result. (Last 50)
      </p>
      <div className="h-[calc(100%-2rem)] overflow-y-auto">
        {logs === null && <p className="text-xs text-slate-500">Loading…</p>}
        {logs?.length === 0 && <p className="text-sm text-slate-400">No activity yet.</p>}
        <table className="w-full text-left text-sm">
          <tbody>
            {shown.map((l) => (
              <Fragment key={l.id}>
                <tr
                  key={l.id}
                  onClick={() => setOpen(open === l.id ? null : l.id)}
                  className="cursor-pointer border-b border-jarvis-cyan/5 hover:bg-white/5"
                >
                  <td className="w-8 py-2">{l.ok ? <span className="text-emerald-400">✓</span> : <span className="text-red-400">✕</span>}</td>
                  <td className="py-2 font-mono text-xs text-jarvis-cyan">{l.tool_name}</td>
                  <td className="max-w-xs truncate py-2 font-mono text-xs text-slate-400">{JSON.stringify(l.args)}</td>
                  <td className="py-2 text-right text-xs text-slate-500">
                    {api.sqliteDate(l.created_at).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
                {open === l.id && (
                  <tr key={`${l.id}-out`}>
                    <td colSpan={4} className="bg-black/30 px-3 py-2">
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-slate-300">{l.output}</pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
