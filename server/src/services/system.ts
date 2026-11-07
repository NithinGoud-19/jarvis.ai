/**
 * Live system stats for the dashboard gauges.
 *
 * 📘 LESSON: Measuring CPU usage
 * os.cpus() gives, for each core, how many milliseconds it has spent "busy" vs "idle"
 * since the computer started. Those numbers only grow. To get CURRENT usage we take two
 * snapshots and compare:  usage = busyTimeBetween / totalTimeBetween.
 * We keep the previous snapshot in memory between requests.
 *
 * 📘 LESSON: Caching
 * The battery check runs PowerShell (~0.5 s). The dashboard asks every few seconds, but the
 * battery changes slowly → we cache it for 60 s instead of running PowerShell every time.
 */
import os from "node:os";
import { getBattery } from "../tools/system.js";

type Snapshot = { idle: number; total: number };

function snapshot(): Snapshot {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return { idle, total };
}

let previous = snapshot();

function cpuPercent(): number {
  const now = snapshot();
  const idle = now.idle - previous.idle;
  const total = now.total - previous.total;
  previous = now;
  return total > 0 ? Math.round((1 - idle / total) * 100) : 0;
}

let batteryCache: { value: { percent: number | null; status: string }; at: number } | null = null;

async function battery() {
  if (batteryCache && Date.now() - batteryCache.at < 60_000) return batteryCache.value;
  try {
    const data = JSON.parse(await getBattery.run({})) as { percent?: number; status?: string };
    batteryCache = { value: { percent: data.percent ?? null, status: data.status ?? "unknown" }, at: Date.now() };
  } catch {
    batteryCache = { value: { percent: null, status: "unknown" }, at: Date.now() };
  }
  return batteryCache.value;
}

export async function systemStats() {
  const total = os.totalmem();
  const used = total - os.freemem();
  const gb = (b: number) => Math.round((b / 1024 ** 3) * 10) / 10;
  return {
    cpuPercent: cpuPercent(),
    cpuModel: os.cpus()[0]?.model.trim() ?? "CPU",
    cpuCores: os.cpus().length,
    ramPercent: Math.round((used / total) * 100),
    ramUsedGB: gb(used),
    ramTotalGB: gb(total),
    uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
    battery: await battery(),
  };
}
