/**
 * Action tools: open apps, open websites, search the web.
 *
 * 📘 LESSON: Allowlist (whitelist)
 * The AI can only pick an app NAME from our list. It can never send a path or command.
 * Want a new app? Add one line to APPS below. (That's your homework! 😉)
 */
import { z } from "zod";
import { defineTool } from "./types.js";
import { openUrl, runPowerShell } from "./exec.js";

const APPS = {
  chrome: { label: "Google Chrome", target: "chrome" },
  edge: { label: "Microsoft Edge", target: "msedge" },
  vscode: { label: "VS Code", target: "code" },
  notepad: { label: "Notepad", target: "shell:AppsFolder\\Microsoft.WindowsNotepad_8wekyb3d8bbwe!App" },
  calculator: { label: "Calculator", target: "shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App" },
  file_explorer: { label: "File Explorer", target: "explorer" },
  task_manager: { label: "Task Manager", target: "taskmgr" },
  settings: { label: "Windows Settings", target: "ms-settings:" },
  paint: { label: "Paint", target: "shell:AppsFolder\\Microsoft.Paint_8wekyb3d8bbwe!App" },
  whatsapp: { label: "WhatsApp", target: "shell:AppsFolder\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App" },
  teams: { label: "Microsoft Teams", target: "shell:AppsFolder\\MSTeams_8wekyb3d8bbwe!MSTeams" },
  zoom: { label: "Zoom Workplace", target: "shell:AppsFolder\\zoom.us.Zoom Video Meetings" },
  outlook: { label: "Outlook", target: "shell:AppsFolder\\Microsoft.OutlookForWindows_8wekyb3d8bbwe!Microsoft.OutlookforWindows" },
  microsoft_todo: { label: "Microsoft To Do", target: "shell:AppsFolder\\Microsoft.Todos_8wekyb3d8bbwe!App" },
  sticky_notes: { label: "Sticky Notes", target: "shell:AppsFolder\\Microsoft.Office.OneNote.MemoryPreview" },
  camera: { label: "Camera", target: "shell:AppsFolder\\Microsoft.WindowsCamera_8wekyb3d8bbwe!App" },
  clock: { label: "Clock", target: "shell:AppsFolder\\Microsoft.WindowsAlarms_8wekyb3d8bbwe!App" },
  photos: { label: "Photos", target: "shell:AppsFolder\\Microsoft.Windows.Photos_8wekyb3d8bbwe!App" },
  media_player: { label: "Media Player", target: "shell:AppsFolder\\Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic" },
  snipping_tool: { label: "Snipping Tool", target: "shell:AppsFolder\\Microsoft.ScreenSketch_8wekyb3d8bbwe!App" },
  sound_recorder: { label: "Sound Recorder", target: "shell:AppsFolder\\Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe!App" },
  weather: { label: "Weather", target: "shell:AppsFolder\\Microsoft.BingWeather_8wekyb3d8bbwe!App" },
  microsoft_store: { label: "Microsoft Store", target: "shell:AppsFolder\\Microsoft.WindowsStore_8wekyb3d8bbwe!App" },
  phone_link: { label: "Phone Link", target: "shell:AppsFolder\\Microsoft.YourPhone_8wekyb3d8bbwe!App" },
  copilot: { label: "Copilot", target: "shell:AppsFolder\\Microsoft.MicrosoftOfficeHub_8wekyb3d8bbwe!Microsoft.MicrosoftOfficeHub" },
  xbox: { label: "Xbox", target: "shell:AppsFolder\\Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App" },
  solitaire: { label: "Solitaire & Casual Games", target: "shell:AppsFolder\\Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe!App" },
  clipchamp: { label: "Microsoft Clipchamp", target: "shell:AppsFolder\\Clipchamp.Clipchamp_yxz26nhyzhsrt!App" },
  whiteboard: { label: "Microsoft Whiteboard", target: "shell:AppsFolder\\Microsoft.Whiteboard_8wekyb3d8bbwe!Whiteboard" },
  lenovo_vantage: { label: "Lenovo Vantage", target: "shell:AppsFolder\\E046963F.LenovoCompanion_k1h2ywk1493x8!App" },
    word: { label: "Word", target: "shell:AppsFolder\\Microsoft.Office.WINWORD.EXE.15" },
  excel: { label: "Excel", target: "shell:AppsFolder\\Microsoft.Office.EXCEL.EXE.15" },
  powerpoint: { label: "PowerPoint", target: "shell:AppsFolder\\Microsoft.Office.POWERPNT.EXE.15" },
  onenote: { label: "OneNote", target: "shell:AppsFolder\\Microsoft.Office.ONENOTE.EXE.15" },
  figma: { label: "Figma", target: "shell:AppsFolder\\com.squirrel.Figma.Figma" },
  antigravity: { label: "Antigravity IDE", target: "shell:AppsFolder\\Google.AntigravityIDE" },

} as const;

type AppName = keyof typeof APPS;
const appNames = Object.keys(APPS) as [AppName, ...AppName[]];

export const openApp = defineTool({
  name: "open_app",
  description: `Open an application on the computer. Available: ${appNames.join(", ")}.`,
  permission: "action",
  schema: z.object({ app: z.enum(appNames) }),
  run: async ({ app }) => {
    const { label, target } = APPS[app];
    // Safe: `target` comes from OUR table above, never from the AI.
    await runPowerShell(`Start-Process '${target}'`);
    return `Opened ${label}.`;
  },
});

/** Accepts "youtube.com" or "https://youtube.com"; rejects anything that isn't http(s). */
function toSafeUrl(input: string): string {
  const withProtocol = /^[a-z]+:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withProtocol); // throws if invalid
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http and https websites are allowed.");
  }
  return url.href;
}

export const openWebsite = defineTool({
  name: "open_website",
  description: "Open a website in the browser, e.g. youtube.com or github.com.",
  permission: "action",
  schema: z.object({ url: z.string().min(3).max(500) }),
  run: async ({ url }) => {
    const safe = toSafeUrl(url);
    await openUrl(safe);
    return `Opened ${safe} in the browser.`;
  },
});

const SEARCH_ENGINES = {
  google: "https://www.google.com/search?q=",
  youtube: "https://www.youtube.com/results?search_query=",
} as const;

export const webSearch = defineTool({
  name: "web_search",
  description:
    "Search Google or YouTube in the browser. Use site='youtube' for videos/songs, otherwise 'google'.",
  permission: "action",
  schema: z.object({
    query: z.string().min(1).max(200),
    site: z.enum(["google", "youtube"]).default("google"),
  }),
  run: async ({ query, site }) => {
    // encodeURIComponent turns "iron man & songs" into "iron%20man%20%26%20songs" (safe in a URL)
    await openUrl(SEARCH_ENGINES[site] + encodeURIComponent(query));
    return `Searched ${site} for "${query}".`;
  },
});
