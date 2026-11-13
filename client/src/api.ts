/**
 * Talks to our backend. The chat endpoint streams Server-Sent Events,
 * so we read the response body piece by piece.
 */
export type ToolActivity = {
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  output?: string;
};
export type Message = { role: "user" | "assistant"; content: string; tools?: ToolActivity[] };

export type Health = {
  server: string;
  ollamaRunning: boolean;
  modelInstalled: boolean;
  model: string;
};

export type Conversation = { id: number; title: string; created_at: string; updated_at: string };
export type ConversationWithMessages = Conversation & { messages: Message[] };
export type Memory = { id: number; content: string; created_at: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Server error ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const getHealth = () => request<Health>("/api/health");
export const listConversations = () => request<Conversation[]>("/api/conversations");
export const getConversation = (id: number) =>
  request<ConversationWithMessages>(`/api/conversations/${id}`);
export const deleteConversation = (id: number) =>
  request<void>(`/api/conversations/${id}`, { method: "DELETE" });
export const listMemories = () => request<Memory[]>("/api/memories");
export const deleteMemory = (id: number) =>
  request<void>(`/api/memories/${id}`, { method: "DELETE" });

export const addMemory = (content: string) =>
  request<Memory>("/api/memories", { method: "POST", body: JSON.stringify({ content }) });

export type GmailStatus = { configured: boolean; connected: boolean; email: string | null };
export const getGmailStatus = () => request<GmailStatus>("/api/gmail/status");
export const disconnectGmail = () => request<void>("/api/gmail/disconnect", { method: "POST" });

export type EmailSummary = {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
  important: boolean;
};
export type Email = EmailSummary & { body: string };
export const listEmails = (q: string, max = 15) =>
  request<EmailSummary[]>(`/api/gmail/messages?${new URLSearchParams({ q, max: String(max) })}`);
export const getEmail = (id: string) => request<Email>(`/api/gmail/messages/${encodeURIComponent(id)}`);

export type SystemStats = {
  cpuPercent: number;
  cpuModel: string;
  cpuCores: number;
  ramPercent: number;
  ramUsedGB: number;
  ramTotalGB: number;
  uptimeHours: number;
  battery: { percent: number | null; status: string };
};
export const getSystem = () => request<SystemStats>("/api/system");

export type Stats = { conversations: number; messages: number; memories: number };
export const getStats = () => request<Stats>("/api/stats");

export type ToolLog = {
  id: number;
  conversation_id: number | null;
  tool_name: string;
  args: Record<string, unknown>;
  ok: boolean;
  output: string;
  created_at: string; // SQLite UTC time "YYYY-MM-DD HH:MM:SS"
};
export const listToolLogs = () => request<ToolLog[]>("/api/tools/logs");

/** SQLite stores UTC without a "Z" → convert to a real Date. */
export const sqliteDate = (s: string) => new Date(s.replace(" ", "T") + "Z");

// ---------- Jobs ----------
export type JobStatus = "new" | "saved" | "applied" | "interview" | "offer" | "rejected" | "ignored";
export type Job = {
  id: number;
  company_id: number;
  company: string;
  title: string;
  location: string;
  url: string;
  posted_at: string | null;
  status: JobStatus;
  first_seen_at: string;
  last_seen_at: string;
  has_description: boolean;
  match_score: number | null;
  match_details: MatchDetails | null;
  ai_review: AiReview | null;
  ai_reviewed_at: string | null;
};
export type MatchDetails = {
  have: string[];
  missing: string[];
  yearsAsked: number | null;
  reasons: string[];
  hasDescription: boolean;
};
export type AiReview = {
  verdict: "strong" | "possible" | "weak";
  summary: string;
  matching: string[];
  gaps: string[];
  tips: string[];
};
export type JobSearchResult = {
  role: string;
  location: string;
  companiesSearched: number;
  failed: { company: string; error: string }[];
  jobs: (Job & { isNew: boolean })[];
  newCount: number;
  ms: number;
};
export type Company = { id: number; name: string; ats: string; slug: string; enabled: 0 | 1 };

export const listJobs = (status?: JobStatus, q?: string, sort: "score" | "recent" = "score") => {
  const params = new URLSearchParams({ sort });
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  return request<Job[]>(`/api/jobs?${params}`);
};
export const getJobCounts = () => request<Record<string, number>>("/api/jobs/counts");
export const searchJobs = (role: string, location: string) =>
  request<JobSearchResult>("/api/jobs/search", { method: "POST", body: JSON.stringify({ role, location }) });
export const setJobStatus = (id: number, status: JobStatus) =>
  request<Job>(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
export const getJob = (id: number) => request<Job & { description: string | null }>(`/api/jobs/${id}`);
export const reviewJob = (id: number) => request<AiReview>(`/api/jobs/${id}/review`, { method: "POST" });
export const rescoreJobs = () => request<{ scored: number }>("/api/jobs/rescore", { method: "POST" });
export type ApplyItem = { question: string; value?: string; reason?: string; remembered?: boolean };
export type ApplySession = {
  jobId: number;
  title: string;
  company: string;
  url: string;
  /** waiting = JARVIS waits for YOU (Workday sign-in). */
  state: "opening" | "waiting" | "filling" | "drafting" | "ready" | "error";
  startedAt: string;
  finishedAt: string | null;
  log: string[];
  filled: ApplyItem[];
  drafted: ApplyItem[];
  needsYou: ApplyItem[];
  sensitive: ApplyItem[];
  resumeUploaded: boolean;
  error: string | null;
  learning: ApplyItem[];
  done: boolean;
  /** Workday: the page you are on ("My Information" …) and what JARVIS wants you to do now. */
  step: string | null;
  hint: string | null;
  /** SmartRecruiters: the job opened in your own browser; `filled` is a copy sheet. */
  assist: boolean;
};
export type SavedAnswer = { id: number; question: string; answer: string; uses: number; updated_at: string };
export const finishApply = (id: number) =>
  request<{ learned: ApplyItem[]; job: Job }>(`/api/jobs/${id}/apply/done`, { method: "POST" });
export const listSavedAnswers = () => request<SavedAnswer[]>("/api/jobs/answers");
export const updateSavedAnswer = (id: number, answer: string) =>
  request<SavedAnswer>(`/api/jobs/answers/${id}`, { method: "PATCH", body: JSON.stringify({ answer }) });
export const deleteSavedAnswer = (id: number) => request<void>(`/api/jobs/answers/${id}`, { method: "DELETE" });
export const startApply = (id: number) => request<ApplySession>(`/api/jobs/${id}/apply`, { method: "POST" });
/** null = never started for this job. */
export const getApplySession = (id: number) =>
  fetch(`/api/jobs/${id}/apply`).then((r) => (r.ok ? (r.json() as Promise<ApplySession>) : null));
export const listCompanies = () => request<Company[]>("/api/jobs/companies");
export const addCompany = (name: string, url: string) =>
  request<Company & { liveJobs: number }>("/api/jobs/companies", { method: "POST", body: JSON.stringify({ name, url }) });
export const deleteCompany = (id: number) => request<void>(`/api/jobs/companies/${id}`, { method: "DELETE" });

export type VoiceStatus ={ speechToText: boolean; textToSpeech: boolean; missing: string[] };
export const getVoiceStatus = () => request<VoiceStatus>("/api/voice/status");

/** Sends WAV audio, gets back the words spoken. */
export async function transcribe(wav: Blob): Promise<{ text: string; silent: boolean; peak: number }> {
  const res = await fetch("/api/voice/transcribe", {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: wav,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
  return body;
}

/** Sends text, gets back WAV audio of JARVIS saying it. */
export async function speak(text: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch("/api/voice/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) throw new Error(`Speech failed (${res.status})`);
  return res.blob();
}

export type StreamHandlers = {
  onStart: (info: { conversationId: number; memorySaved: string | null }) => void;
  onToken: (token: string) => void;
  onTool: (activity: ToolActivity) => void;
};

export async function streamChat(
  body: { conversationId?: number; message: string },
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Server error ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by a blank line
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      if (!event.startsWith("data: ")) continue;
      const data = JSON.parse(event.slice(6));
      if (data.type === "start") handlers.onStart(data);
      else if (data.type === "token") handlers.onToken(data.token);
      else if (data.type === "tool") handlers.onTool(data);
      else if (data.type === "error") throw new Error(data.error);
    }
  }
}

// ---------- Tasks & reminders ----------
export type Task = {
  id: number;
  text: string;
  due_at: string | null; // UTC from SQLite → use sqliteDate()
  done: boolean;
  notified_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  completed_at: string | null;
};
export type TaskFilter = "open" | "done" | "all";
export const listTasks = (show: TaskFilter = "open") => request<Task[]>(`/api/tasks?show=${show}`);
export const addTask = (text: string, when?: string) =>
  request<Task>("/api/tasks", { method: "POST", body: JSON.stringify({ text, when: when || undefined }) });
export const updateTask = (id: number, changes: { text?: string; when?: string | null; done?: boolean }) =>
  request<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(changes) });
export const snoozeTask = (id: number, minutes: number) =>
  request<Task>(`/api/tasks/${id}/snooze`, { method: "POST", body: JSON.stringify({ minutes }) });
export const deleteTask = (id: number) => request<void>(`/api/tasks/${id}`, { method: "DELETE" });

/** Live messages the server pushes (GET /api/events, Server-Sent Events). */
export type ServerEvent =
  | { type: "reminder"; task: Pick<Task, "id" | "text" | "due_at">; missed: boolean }
  | { type: "tasks-changed" };
export const listRinging = () => request<Task[]>("/api/tasks/ringing");
export const dismissReminder = (id: number) => request<void>(`/api/tasks/${id}/dismiss`, { method: "POST" });
