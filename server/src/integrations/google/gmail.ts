/**
 * Gmail REST API client (read-only).
 * Docs: https://developers.google.com/gmail/api/reference/rest
 *
 * 📘 LESSON: Calling a third-party API
 * Every request carries the header  Authorization: Bearer <access token>
 * "Bearer" = "whoever bears (holds) this token is allowed in". That's why tokens are secret.
 */
import { getAccessToken, GoogleAuthError } from "./oauth.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailGet<T>(pathAndQuery: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API}${pathAndQuery}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = (await res.json()) as T & { error?: { message: string; code: number } };
  if (!res.ok) {
    if (res.status === 401) throw new GoogleAuthError("Gmail access was revoked. Please reconnect.");
    throw new Error(`Gmail API ${res.status}: ${data.error?.message ?? "request failed"}`);
  }
  return data;
}

type Header = { name: string; value: string };
type Part = { mimeType: string; body?: { data?: string }; parts?: Part[]; headers?: Header[] };
type RawMessage = {
  id: string;
  threadId: string;
  snippet: string;
  labelIds?: string[];
  internalDate: string;
  payload: Part;
};

export type EmailSummary = {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
  important: boolean;
};

const header = (m: RawMessage, name: string) =>
  m.payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** Gmail's snippet contains HTML entities like &#39; → turn them into normal characters. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function toSummary(m: RawMessage): EmailSummary {
  return {
    id: m.id,
    from: header(m, "From"),
    subject: header(m, "Subject") || "(no subject)",
    date: new Date(Number(m.internalDate)).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
    snippet: decodeEntities(m.snippet).slice(0, 160),
    unread: m.labelIds?.includes("UNREAD") ?? false,
    important: m.labelIds?.includes("IMPORTANT") ?? false,
  };
}

/**
 * Search emails with normal Gmail search syntax, e.g.
 *   "is:unread"  ·  "from:linkedin"  ·  "newer_than:1d"  ·  "subject:interview"
 */
export async function searchEmails(query: string, max: number): Promise<EmailSummary[]> {
  const params = new URLSearchParams({ q: query, maxResults: String(max) });
  const list = await gmailGet<{ messages?: { id: string }[] }>(`/messages?${params}`);
  if (!list.messages?.length) return [];

  // Fetch only the headers we need for each email, all in parallel
  const meta = "format=metadata&metadataHeaders=From&metadataHeaders=Subject";
  const messages = await Promise.all(
    list.messages.map((m) => gmailGet<RawMessage>(`/messages/${encodeURIComponent(m.id)}?${meta}`)),
  );
  return messages.map(toSummary);
}

/** Finds the readable text inside an email (emails are trees of "parts"). */
function extractText(part: Part): string {
  const decode = (data?: string) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");
  if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
  if (part.parts) {
    // Prefer plain text anywhere in the tree; fall back to HTML
    for (const p of part.parts) {
      const text = extractText(p);
      if (text) return text;
    }
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeEntities(
      decode(part.body.data)
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
        .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
        .replace(/<[^>]+>/g, ""),
    );
  }
  return "";
}

export async function readEmail(id: string): Promise<EmailSummary & { body: string }> {
  const m = await gmailGet<RawMessage>(`/messages/${encodeURIComponent(id)}?format=full`);
  const body = extractText(m.payload)
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { ...toSummary(m), body: body.slice(0, 3000) + (body.length > 3000 ? "\n…(truncated)" : "") };
}
