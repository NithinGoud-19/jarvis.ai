import { useEffect, useState, type FormEvent } from "react";
import * as api from "../api";
import type { Task, TaskFilter } from "../api";
import { Panel } from "../components/Panel";

/** "today 6:00 pm" / "tomorrow 9:00 am" / "Fri 20 Nov, 5:00 pm" */
export function formatDue(d: Date, now = new Date()): string {
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  if (diff === 0) return `today ${time}`;
  if (diff === 1) return `tomorrow ${time}`;
  if (diff === -1) return `yesterday ${time}`;
  return `${d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

const TIME_EXAMPLES = ["in 30 minutes", "at 6 pm", "tomorrow 9am", "friday 5pm"];

/** To-do list + reminders. Reloads by itself when tasks change anywhere (chat, another tab, a reminder firing). */
export function TasksView({ active, refreshKey }: { active: boolean; refreshKey: number }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [show, setShow] = useState<TaskFilter>("open");
  const [text, setText] = useState("");
  const [when, setWhen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());

  const load = () => api.listTasks(show).then(setTasks).catch((e) => setError(String(e)));
  useEffect(() => {
    if (active) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, show, refreshKey]);

  // Keep "overdue" colours correct while the page stays open
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Wraps every button action: show the server's friendly error, then reload the list
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    load();
  };

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await api.addTask(text.trim(), when.trim());
      setText("");
      setWhen("");
      setError(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); // e.g. "couldn't understand the time"
    }
  }

  async function changeTime(t: Task) {
    const next = prompt(`New time for "${t.text}" (e.g. ${TIME_EXAMPLES.join(", ")}). Leave empty to remove the reminder.`);
    if (next === null) return; // cancelled
    await run(() => api.updateTask(t.id, { when: next.trim() || null }));
  }

  const reminders = tasks?.filter((t) => t.due_at && !t.done) ?? [];
  const todos = tasks?.filter((t) => !t.due_at || t.done) ?? [];

  const row = (t: Task) => {
    const due = t.due_at ? api.sqliteDate(t.due_at) : null;
    const overdue = due && !t.done && due <= now;
    return (
      <li key={t.id} className="group fade-up flex items-center gap-3 rounded-md border border-jarvis-cyan/10 bg-black/25 px-3 py-2.5">
        <input
          type="checkbox"
          checked={t.done}
          onChange={() => run(() => api.updateTask(t.id, { done: !t.done }))}
          className="h-4 w-4 shrink-0 cursor-pointer accent-cyan-400"
          title={t.done ? "Mark as not done" : "Mark as done"}
        />
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${t.done ? "text-slate-500 line-through" : "text-slate-200"}`}>{t.text}</p>
          {due && (
            <button
              onClick={() => !t.done && changeTime(t)}
              className={`mt-0.5 text-[11px] ${overdue ? "text-amber-400" : "text-jarvis-cyan/80"} ${t.done ? "" : "hover:underline"}`}
              title={t.done ? undefined : "Change time"}
            >
              ⏰ {formatDue(due, now)}
              {overdue && " · rang"}
            </button>
          )}
        </div>
        {!t.done && overdue && (
          <button onClick={() => run(() => api.snoozeTask(t.id, 10))} className="text-xs text-slate-400 hover:text-jarvis-cyan">
            Snooze 10m
          </button>
        )}
        {!t.done && !due && (
          <button
            onClick={() => changeTime(t)}
            className="text-xs text-slate-500 opacity-0 transition hover:text-jarvis-cyan group-hover:opacity-100"
          >
            + time
          </button>
        )}
        <button
          onClick={() => run(() => api.deleteTask(t.id))}
          className="text-xs text-slate-500 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
        >
          Delete
        </button>
      </li>
    );
  };

  const tab = (id: TaskFilter, label: string) => (
    <button
      onClick={() => setShow(id)}
      className={`rounded px-2 py-0.5 text-[11px] tracking-wider ${show === id ? "bg-jarvis-cyan/20 text-jarvis-cyan" : "text-slate-500 hover:text-slate-300"}`}
    >
      {label}
    </button>
  );

  return (
    <Panel
      title="TASKS & REMINDERS"
      className="mx-auto h-full max-w-3xl"
      right={
        <div className="flex gap-1">
          {tab("open", "OPEN")}
          {tab("done", "DONE")}
          {tab("all", "ALL")}
        </div>
      }
    >
      <div className="flex h-full flex-col">
        <p className="mb-3 text-sm text-slate-400">
          Add a time to make it a reminder: JARVIS shows a Windows notification and says it out loud. In the chat you can also say
          “Remind me to call mom at 6 pm”.
        </p>
        <form onSubmit={add} className="mb-4 flex flex-wrap gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
            placeholder="What? e.g. Call mom"
            className="min-w-48 flex-[2] rounded-md border border-jarvis-cyan/30 bg-black/40 px-3 py-2 text-sm outline-none focus:border-jarvis-cyan"
          />
          <input
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            maxLength={100}
            list="when-examples"
            placeholder="When? (optional) e.g. at 6 pm"
            className="min-w-40 flex-1 rounded-md border border-jarvis-cyan/30 bg-black/40 px-3 py-2 text-sm outline-none focus:border-jarvis-cyan"
          />
          <datalist id="when-examples">
            {TIME_EXAMPLES.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          <button
            disabled={!text.trim()}
            className="rounded-md bg-jarvis-cyan/20 px-4 font-hud text-xs tracking-widest text-jarvis-cyan hover:bg-jarvis-cyan/30 disabled:opacity-40"
          >
            {when.trim() ? "REMIND" : "ADD"}
          </button>
        </form>
        {error && <p className="mb-3 text-sm text-red-400">⚠ {error}</p>}

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {tasks === null && <p className="text-xs text-slate-500">Loading…</p>}
          {tasks?.length === 0 && (
            <p className="text-sm text-slate-400">{show === "done" ? "Nothing completed yet." : "All clear, Sir. Nothing to do."}</p>
          )}
          {reminders.length > 0 && (
            <section>
              <h3 className="mb-2 font-hud text-[10px] tracking-[0.25em] text-slate-500">⏰ REMINDERS</h3>
              <ul className="space-y-2">{reminders.map(row)}</ul>
            </section>
          )}
          {todos.length > 0 && (
            <section>
              <h3 className="mb-2 font-hud text-[10px] tracking-[0.25em] text-slate-500">
                {show === "done" ? "✓ COMPLETED" : "☐ TO-DO"}
              </h3>
              <ul className="space-y-2">{todos.map(row)}</ul>
            </section>
          )}
        </div>
      </div>
    </Panel>
  );
}
