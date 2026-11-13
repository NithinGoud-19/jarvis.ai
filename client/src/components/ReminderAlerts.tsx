import * as api from "../api";
import type { ServerEvent } from "../api";
import { formatDue } from "../views/TasksView";

export type ReminderAlert = Extract<ServerEvent, { type: "reminder" }>;

/** Glowing cards at the top of every page when a reminder rings: Done / Snooze / Dismiss. */
export function ReminderAlerts({ alerts, onClose }: { alerts: ReminderAlert[]; onClose: (taskId: number) => void }) {
  if (alerts.length === 0) return null;

  const act = (taskId: number, action: () => Promise<unknown>) =>
    action()
      .catch(() => {}) // already deleted elsewhere → nothing to do, just close the card
      .finally(() => onClose(taskId));

  return (
    <div className="space-y-2 px-5 pt-3">
      {alerts.map(({ task, missed }) => (
        <div
          key={task.id}
          className="fade-up flex flex-wrap items-center gap-3 rounded-md border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 shadow-[0_0_18px_rgba(251,191,36,0.15)]"
        >
          <span className="text-lg">⏰</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-amber-200">{task.text}</p>
            {missed && task.due_at && (
              <p className="text-[11px] text-amber-300/70">Missed while JARVIS was off — was due {formatDue(api.sqliteDate(task.due_at))}</p>
            )}
          </div>
          <button
            onClick={() => act(task.id, () => api.updateTask(task.id, { done: true }))}
            className="rounded bg-emerald-500/20 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-500/30"
          >
            ✓ Done
          </button>
          <button
            onClick={() => act(task.id, () => api.snoozeTask(task.id, 10))}
            className="rounded bg-white/5 px-3 py-1 text-xs text-slate-300 hover:bg-white/10"
          >
            Snooze 10m
          </button>
          <button onClick={() => onClose(task.id)} className="text-xs text-slate-400 hover:text-slate-200" title="Hide (keeps the task)">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
