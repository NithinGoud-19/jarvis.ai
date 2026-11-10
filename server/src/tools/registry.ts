/**
 * 📘 LESSON: Tool registry
 * ONE place that lists every tool JARVIS may use. The rest of the app asks the
 * registry: "what tools exist?" and "please run tool X". To add a tool, write it,
 * then add it to the TOOLS array. Nothing else changes.
 *
 * executeTool() is the "gatekeeper": unknown tool → refuse. Bad arguments → refuse.
 * Every attempt (success or failure) is logged to the database.
 */
import { z } from "zod";
import type { Tool } from "./types.js";
import { getBattery, getSystemInfo, getTime } from "./system.js";
import { openApp, openWebsite, webSearch } from "./apps.js";
import { listFolder } from "./files.js";
import { gmailRead, gmailSearch } from "./gmail.js";
import { jobApply, jobSearch, jobsList, jobUpdateStatus } from "./jobs.js";
import { logToolCall } from "../database/toolLogs.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOLS: Tool<any>[] = [
  getTime,
  getSystemInfo,
  getBattery,
  openApp,
  openWebsite,
  webSearch,
  listFolder,
  gmailSearch,
  gmailRead,
  jobSearch,
  jobsList,
  jobUpdateStatus,
  jobApply,
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

/** Public info about each tool (for GET /api/tools). */
export function listTools() {
  return TOOLS.map(({ name, description, permission }) => ({ name, description, permission }));
}

/** Tool definitions in the format Ollama expects (JSON Schema). */
export function toolDefinitionsForAI() {
  return TOOLS.map((t) => {
    const { $schema: _ignored, ...parameters } = z.toJSONSchema(t.schema) as Record<string, unknown>;
    return { type: "function", function: { name: t.name, description: t.description, parameters } };
  });
}

export type ToolResult = { ok: boolean; output: string };

export async function executeTool(
  name: string,
  rawArgs: unknown,
  conversationId: number | null,
): Promise<ToolResult> {
  const tool = byName.get(name);
  let result: ToolResult;

  if (!tool) {
    result = { ok: false, output: `Unknown tool "${name}". It is not allowed.` };
  } else {
    const args = tool.schema.safeParse(rawArgs ?? {});
    if (!args.success) {
      result = { ok: false, output: `Invalid arguments: ${args.error.issues.map((i: z.core.$ZodIssue) => i.message).join("; ")}` };
    } else {
      try {
        result = { ok: true, output: await tool.run(args.data) };
      } catch (err) {
        result = { ok: false, output: `Failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
  }

  logToolCall({ conversationId, toolName: name, args: rawArgs, ...result });
  console.log(`🔧 ${name}(${JSON.stringify(rawArgs)}) → ${result.ok ? "ok" : "FAILED"}`);
  return result;
}
