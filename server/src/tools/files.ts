/**
 * Read-only file tool. JARVIS can only LOOK inside a few known folders.
 * (Creating, moving or deleting files will come later, WITH your approval.)
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { defineTool } from "./types.js";

/** Windows may move Desktop/Documents into OneDrive — check both places. */
function resolveFolder(name: "Desktop" | "Documents" | "Downloads"): string {
  const home = os.homedir();
  const candidates = [path.join(home, "OneDrive", name), path.join(home, name)];
  return candidates.find((p) => existsSync(p)) ?? path.join(home, name);
}

const FOLDERS = {
  desktop: () => resolveFolder("Desktop"),
  documents: () => resolveFolder("Documents"),
  downloads: () => resolveFolder("Downloads"),
} as const;

export const listFolder = defineTool({
  name: "list_folder",
  description:
    "List the newest files in the user's desktop, documents or downloads folder.",
  permission: "read",
  schema: z.object({ folder: z.enum(["desktop", "documents", "downloads"]) }),
  run: async ({ folder }) => {
    const dir = FOLDERS[folder]();
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const items = await Promise.all(
      entries
        .filter((e) => !e.name.startsWith(".") && e.name !== "desktop.ini")
        .map(async (e) => {
          const stat = await fs.stat(path.join(dir, e.name)).catch(() => null);
          return { name: e.name, type: e.isDirectory() ? "folder" : "file", modified: stat?.mtimeMs ?? 0 };
        }),
    );
    items.sort((a, b) => b.modified - a.modified); // newest first
    return JSON.stringify({
      folder,
      total: items.length,
      newest: items.slice(0, 15).map(({ name, type }) => ({ name, type })),
    });
  },
});
