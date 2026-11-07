/** Read-only tools: time, system info, battery. */
import os from "node:os";
import { z } from "zod";
import { defineTool } from "./types.js";
import { runPowerShell } from "./exec.js";

export const getTime = defineTool({
  name: "get_time",
  description: "Get the current local date, time and day of the week.",
  permission: "read",
  schema: z.object({}),
  run: async () => {
    const now = new Date();
    return JSON.stringify({
      date: now.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }),
      time: now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      day: now.toLocaleDateString("en-IN", { weekday: "long" }),
    });
  },
});

export const getSystemInfo = defineTool({
  name: "get_system_info",
  description: "Get computer info: CPU, RAM usage, uptime and Windows version.",
  permission: "read",
  schema: z.object({}),
  run: async () => {
    const gb = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10;
    const total = os.totalmem();
    const free = os.freemem();
    return JSON.stringify({
      cpu: os.cpus()[0]?.model.trim(),
      cpuCores: os.cpus().length,
      ramTotalGB: gb(total),
      ramUsedGB: gb(total - free),
      ramUsedPercent: Math.round(((total - free) / total) * 100),
      uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
      os: `${os.version()} (${os.release()})`,
    });
  },
});

// Win32_Battery.BatteryStatus codes → words
const BATTERY_STATUS: Record<number, string> = {
  1: "discharging (on battery)",
  2: "plugged in",
  3: "fully charged",
  4: "low",
  5: "critical",
  6: "charging",
  7: "charging (high)",
  8: "charging (low)",
  9: "charging (critical)",
};

export const getBattery = defineTool({
  name: "get_battery",
  description: "Get the laptop battery percentage and whether it is charging.",
  permission: "read",
  schema: z.object({}),
  run: async () => {
    const out = await runPowerShell(
      "Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json",
    );
    if (!out) return JSON.stringify({ error: "No battery found (desktop PC?)" });
    const b = JSON.parse(out) as { EstimatedChargeRemaining: number; BatteryStatus: number };
    return JSON.stringify({
      percent: b.EstimatedChargeRemaining,
      status: BATTERY_STATUS[b.BatteryStatus] ?? "unknown",
    });
  },
});
