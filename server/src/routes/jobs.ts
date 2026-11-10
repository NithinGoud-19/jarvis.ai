/**
 * Job search + tracker API
 *
 *   GET    /api/jobs?status=&q=&sort=  → tracker list (hides "ignored" unless asked; sort=score|recent)
 *   GET    /api/jobs/:id               → one job WITH its description
 *   POST   /api/jobs/:id/review        → AI deep review of one job vs your profile (slow: ~1 min)
 *   POST   /api/jobs/:id/apply         → open + FILL the application form in Edge (never submits). Returns a session
 *   GET    /api/jobs/:id/apply         → progress of that form-filling session (the UI polls this)
 *   POST   /api/jobs/:id/apply/done    → "I submitted it": save your typed answers + mark applied
 *   GET    /api/jobs/answers           → the answer bank (what JARVIS learned from you)
 *   PATCH  /api/jobs/answers/:id       → edit a saved answer   body: { answer }
 *   DELETE /api/jobs/answers/:id       → forget it
 *   POST   /api/jobs/rescore           → re-score every job (after you edit data/profile.json)
 *   GET    /api/jobs/counts            → { new: 12, applied: 3, ... }
 *   POST   /api/jobs/search            → live search   body: { role, location? }
 *   PATCH  /api/jobs/:id               → change status body: { status }
 *   GET    /api/jobs/companies         → companies JARVIS checks
 *   POST   /api/jobs/companies         → add one by its careers link   body: { name, url }
 *   DELETE /api/jobs/companies/:id     → remove (its jobs are removed too — ON DELETE CASCADE)
 *
 * 📘 LESSON: Route ORDER matters in Express
 * "/companies" and "/counts" are declared BEFORE "/:id". Otherwise Express would think
 * "companies" is an :id and send it to the wrong handler.
 */
import { Router } from "express";
import { z } from "zod";
import { idParam } from "./params.js";
import {
  addCompany,
  deleteCompany,
  findCompany,
  JOB_STATUSES,
  jobCounts,
  listCompanies,
  listJobs,
  updateJobStatus,
} from "../database/jobs.js";
import { searchJobs } from "../services/jobSearch.js";
import { scoreJobs } from "../services/jobScoring.js";
import { reviewJob, ReviewError } from "../services/jobReview.js";
import { OllamaError } from "../services/ollama.js";
import { getJobDetail } from "../database/jobs.js";
import { fetchCompanyJobs, parseCareersUrl } from "../integrations/ats/fetchers.js";
import { ApplyError, finishApply, getApplySession, startApply } from "../services/apply/applyAgent.js";
import { deleteSavedAnswer, listSavedAnswers, updateSavedAnswer } from "../database/answers.js";

export const jobsRouter = Router();

const listQuery = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(["score", "recent"]).default("score"),
});

jobsRouter.get("/", (req, res) => {
  const query = listQuery.safeParse(req.query);
  if (!query.success) return void res.status(400).json({ error: "Invalid query" });
  res.json(listJobs({ status: query.data.status, search: query.data.q || undefined, sort: query.data.sort }));
});

jobsRouter.get("/counts", (_req, res) => {
  res.json(jobCounts());
});

const searchBody = z.object({
  role: z.string().trim().min(2).max(80),
  location: z.string().trim().max(40).default("India"),
});

// 📘 This handler is "async" because it waits for network calls. Express 5 catches
// errors thrown in async handlers and sends them to our errorHandler automatically.
jobsRouter.post("/search", async (req, res) => {
  const body = searchBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Give a role (2–80 characters)" });
  res.json(await searchJobs(body.data.role, body.data.location));
});

jobsRouter.get("/companies", (_req, res) => {
  res.json(listCompanies());
});

const companyBody = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().url().max(300),
});

jobsRouter.post("/companies", async (req, res) => {
  const body = companyBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Give a company name and its careers link" });

  const parsed = parseCareersUrl(body.data.url);
  if (!parsed) {
    return void res.status(400).json({
      error: "JARVIS can't read that careers page yet. Supported: Greenhouse, Lever, Ashby, SmartRecruiters, Workday links.",
    });
  }
  if (findCompany(parsed.ats, parsed.slug)) {
    return void res.status(409).json({ error: "That company is already in the list." }); // 409 = Conflict
  }

  // Test the link BEFORE saving, so a typo doesn't silently break every search later.
  const candidate = { id: 0, name: body.data.name, enabled: 1 as const, created_at: "", ...parsed };
  try {
    const jobs = await fetchCompanyJobs(candidate, { searchText: "", location: "" });
    const company = addCompany({ name: body.data.name, ...parsed });
    res.status(201).json({ ...company, liveJobs: jobs.length });
  } catch (err) {
    res.status(400).json({ error: `Couldn't read jobs from that link (${err instanceof Error ? err.message : err}).` });
  }
});

jobsRouter.delete("/companies/:id", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid id" });
  if (!deleteCompany(id.data)) return void res.status(404).json({ error: "Company not found" });
  res.status(204).end();
});

// ---- answer bank (declared before "/:id" — see the lesson at the top) ----
jobsRouter.get("/answers", (_req, res) => {
  res.json(listSavedAnswers());
});

const answerBody = z.object({ answer: z.string().trim().min(1).max(1000) });

jobsRouter.patch("/answers/:id", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = answerBody.safeParse(req.body);
  if (!id.success || !body.success) return void res.status(400).json({ error: "Give an answer (1–1000 characters)" });
  const saved = updateSavedAnswer(id.data, body.data.answer);
  if (!saved) return void res.status(404).json({ error: "Saved answer not found" });
  res.json(saved);
});

jobsRouter.delete("/answers/:id", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid id" });
  if (!deleteSavedAnswer(id.data)) return void res.status(404).json({ error: "Saved answer not found" });
  res.status(204).end();
});

jobsRouter.post("/rescore",async (_req, res) => {
  const result = await scoreJobs();
  if (result.noProfile) return void res.status(400).json({ error: "No profile yet (server/data/profile.json)." });
  res.json(result);
});

jobsRouter.get("/:id", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid id" });
  const job = getJobDetail(id.data);
  if (!job) return void res.status(404).json({ error: "Job not found" });
  res.json(job);
});

jobsRouter.post("/:id/review", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid id" });
  try {
    res.json(await reviewJob(id.data));
  } catch (err) {
    // 📘 Known errors → a clear status + message. Unknown ones → re-throw to the error handler (500).
    if (err instanceof ReviewError || err instanceof OllamaError) {
      return void res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
});

// 📘 202 Accepted = "I started the work, it isn't finished yet". The client polls GET for progress.
jobsRouter.post("/:id/apply", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid id" });
  try {
    res.status(202).json(startApply(id.data));
  } catch (err) {
    if (err instanceof ApplyError) return void res.status(err.status).json({ error: err.message });
    throw err;
  }
});

jobsRouter.get("/:id/apply", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid id" });
  const session = getApplySession(id.data);
  if (!session) return void res.status(404).json({ error: "No form-filling started for this job" });
  res.json(session);
});

jobsRouter.post("/:id/apply/done", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid id" });
  const result = await finishApply(id.data);
  if (!result.job) return void res.status(404).json({ error: "Job not found" });
  res.json(result);
});

const statusBody = z.object({ status: z.enum(JOB_STATUSES) });

jobsRouter.patch("/:id", (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = statusBody.safeParse(req.body);
  if (!id.success || !body.success) return void res.status(400).json({ error: "Invalid request" });
  const job = updateJobStatus(id.data, body.data.status);
  if (!job) return void res.status(404).json({ error: "Job not found" });
  res.json(job);
});
