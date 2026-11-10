/**
 * TEMPORARY read-only recorder (deleted after Step 3c). It NEVER types or clicks.
 * Opens two tabs (SmartRecruiters + Workday). Every 4 s, if a tab's form changed, it saves
 * a structural dump (including shadow DOM) + screenshot to the scratchpad.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const OUT = process.env.S!;
const PROFILE = path.resolve("data/browser-profile"); // the real JARVIS profile → your logins are kept
const URLS = {
  sr: "https://jobs.smartrecruiters.com/oneclick-ui/company/Freshworks/publication/40c2115a-9c8b-4789-b3ec-70fee90867cd?dcr_ci=Freshworks",
  wd: "https://amgen.wd1.myworkdayjobs.com/en-US/Careers/job/India---Hyderabad/Fullstack-Developer_R-246940/apply/applyManually",
};

const DUMP = String.raw`(() => {
  const KEEP = ["id","name","type","role","aria-label","aria-labelledby","aria-describedby","aria-required","aria-haspopup","aria-expanded","aria-checked","aria-pressed","data-automation-id","data-test","data-testid","for","placeholder","required","value","class","tabindex","hidden","aria-hidden","autocomplete","formcontrolname"];
  let fields = 0;
  const ser = (node, depth) => {
    if (depth > 60) return "";
    if (node.nodeType === 3) { const t = node.textContent.replace(/\s+/g, " ").trim(); return t ? " ".repeat(depth) + JSON.stringify(t.slice(0, 160)) + "\n" : ""; }
    if (node.nodeType !== 1) return "";
    const el = node, tag = el.tagName.toLowerCase();
    if (["script","style","svg","noscript","link","meta","path","iframe"].includes(tag)) return tag === "iframe" ? " ".repeat(depth) + "<iframe src=" + el.src + ">\n" : "";
    if (/^(input|select|textarea)$/.test(tag)) fields++;
    const attrs = KEEP.map((a) => el.hasAttribute(a) ? " " + a + "=" + JSON.stringify((a === "class" ? el.getAttribute(a).slice(0, 80) : el.getAttribute(a) || "").slice(0, 120)) : "").join("");
    let s = " ".repeat(depth) + "<" + tag + attrs + ">\n";
    if (el.shadowRoot) { s += " ".repeat(depth + 1) + "#shadow\n"; for (const c of el.shadowRoot.childNodes) s += ser(c, depth + 2); }
    for (const c of el.childNodes) s += ser(c, depth + 1);
    if (tag === "select") s += " ".repeat(depth + 1) + "[options: " + [...el.options].slice(0, 15).map((o) => o.text).join(" | ") + "]\n";
    return s;
  };
  const html = ser(document.body, 0);
  return { url: location.href, title: document.title, fields, html };
})()`;

const ctx = await chromium.launchPersistentContext(PROFILE, { channel: "msedge", headless: false, viewport: null });
const pages = { sr: ctx.pages()[0] ?? (await ctx.newPage()), wd: await ctx.newPage() };
await pages.sr.goto(URLS.sr, { waitUntil: "domcontentloaded" }).catch(() => {});
await pages.wd.goto(URLS.wd, { waitUntil: "domcontentloaded" }).catch(() => {});

const last: Record<string, string> = {};
let n = 0;
const until = Date.now() + 25 * 60_000;
let closed = false;
ctx.on("close", () => (closed = true));
while (!closed && Date.now() < until) {
  for (const [k, p] of Object.entries(pages)) {
    if (p.isClosed()) continue;
    try {
      const d = (await p.evaluate(DUMP)) as { url: string; title: string; fields: number; html: string };
      const sig = d.url.split("?")[0] + "|" + d.fields + "|" + d.html.length;
      if (last[k] && Math.abs(d.html.length - Number(last[k].split("|")[2])) < 300 && last[k].split("|")[0] === sig.split("|")[0] && last[k].split("|")[1] === String(d.fields)) continue;
      last[k] = sig;
      const name = `${k}-${String(++n).padStart(2, "0")}`;
      fs.writeFileSync(path.join(OUT, `rec-${name}.txt`), `${d.url}\n${d.title}\nfields=${d.fields}\n\n${d.html}`);
      await p.screenshot({ path: path.join(OUT, `rec-${name}.png`), fullPage: true }).catch(() => {});
      console.log(new Date().toLocaleTimeString(), "saved", name, d.fields, "fields", d.url.slice(0, 100));
    } catch { /* page navigating */ }
  }
  await new Promise((r) => setTimeout(r, 4000));
}
console.log("recorder finished");
await ctx.close().catch(() => {});
process.exit(0);
