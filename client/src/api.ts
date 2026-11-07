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

export type VoiceStatus = { speechToText: boolean; textToSpeech: boolean; missing: string[] };
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
