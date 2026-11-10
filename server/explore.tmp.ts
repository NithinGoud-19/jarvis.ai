import { chromium } from "playwright-core";
const ctx = await chromium.launchPersistentContext(process.env.S + "/edge-test", { channel: "msedge", headless: false, viewport: null });
const p = ctx.pages()[0] ?? await ctx.newPage();
const dump = async (tag: string) => {
  console.log("==", tag, p.url());
  console.log(JSON.stringify(await p.evaluate(`[...document.querySelectorAll('input,select,textarea,button,a[data-automation-id]')].filter(e=>e.offsetParent).map(e=>e.tagName+' type='+(e.type||'')+' aid='+(e.getAttribute('data-automation-id')||'')+' aria='+(e.getAttribute('aria-label')||'')+' txt='+(e.textContent||'').trim().slice(0,40)).slice(0,40)`), null, 1));
  await p.screenshot({ path: `${process.env.S}/wd-${tag}.png` });
};
await p.goto("https://amgen.wd1.myworkdayjobs.com/Careers/job/India---Hyderabad/Fullstack-Developer_R-246940", { waitUntil: "domcontentloaded", timeout: 45000 });
await p.waitForTimeout(6000); await dump("job");
await p.locator('[data-automation-id="adventureButton"]').first().click().catch(e=>console.log("no apply btn", e.message));
await p.waitForTimeout(4000); await dump("apply");
await p.locator('[data-automation-id="applyManually"]').first().click().catch(e=>console.log("no manual", e.message));
await p.waitForTimeout(5000); await dump("manual");
await ctx.close();
