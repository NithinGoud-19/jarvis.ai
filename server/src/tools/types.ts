/**
 * 📘 LESSON: What is a "tool"?
 * A tool is a small function JARVIS is ALLOWED to use. Each tool has:
 *   - name + description → the AI reads these to decide WHEN to use it
 *   - schema (zod)       → the exact arguments allowed; we validate before running
 *   - permission         → "read" (only looks at things) or "action" (changes/opens something)
 *   - run()              → OUR code that does the work
 *
 * The AI never runs code. It only says: "please call open_app with {app: 'chrome'}".
 * The backend checks everything and decides.
 */
import type { z } from "zod";

export type ToolPermission = "read" | "action";

export type Tool<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  permission: ToolPermission;
  schema: S;
  run: (args: z.infer<S>) => Promise<string>;
};

/** Helper so TypeScript knows the exact argument type inside run(). */
export function defineTool<S extends z.ZodType>(tool: Tool<S>): Tool<S> {
  return tool;
}
