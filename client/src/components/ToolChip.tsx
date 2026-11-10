import type { ToolActivity } from "../api";

const LABELS: Record<string, string> = {
  get_time: "Checking the time",
  get_system_info: "Reading system info",
  get_battery: "Checking battery",
  open_app: "Opening app",
  open_website: "Opening website",
  web_search: "Searching",
  list_folder: "Looking in folder",
  gmail_search: "Searching Gmail",
  gmail_read: "Reading email",
  job_search: "Scanning career pages",
  jobs_list: "Checking job tracker",
  job_update_status: "Updating job",
  job_apply: "Filling application",
};

function describeArgs(args: Record<string, unknown>): string {
  const values = Object.values(args).filter((v) => v !== undefined && v !== "");
  return values.length ? ` · ${values.join(" · ")}` : "";
}

export function ToolChip({ tool }: { tool: ToolActivity }) {
  const style = {
    running: "border-jarvis-cyan/40 text-jarvis-cyan animate-pulse",
    done: "border-emerald-400/40 text-emerald-300",
    error: "border-red-400/50 text-red-300",
  }[tool.status];
  const icon = { running: "⚙", done: "✓", error: "✕" }[tool.status];

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] ${style}`}
      title={tool.output}
    >
      <span>{icon}</span>
      <span>
        {LABELS[tool.name] ?? tool.name}
        {describeArgs(tool.args)}
      </span>
    </div>
  );
}
