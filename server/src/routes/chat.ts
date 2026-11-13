/**
 * POST /api/chat
 * Body: { conversationId?: number, message: "..." }
 * Response: a stream of Server-Sent Events (SSE):
 *   { type: "start", conversationId, memorySaved? }  → first event
 *   { type: "token", token }                         → many times
 *   { type: "tool", status, name, args, output? }    → when JARVIS uses a tool
 *   { type: "done" } or { type: "error", error }     → last event
 *
 * 📘 LESSON: The server is the "source of truth"
 * In Phase 1 the browser sent the WHOLE chat history every time. Now the browser
 * sends only the NEW message; the server loads history from the database.
 * Benefits: smaller requests, the client can't fake history, and chats survive refresh.
 *
 * Steps:
 *   1. validate → 2. find or create conversation → 3. save user message
 *   4. load history + memories → 5. stream AI reply → 6. save AI reply
 */
import { Router } from "express";
import { z } from "zod";
import { streamChat, type ChatMessage, type ToolCall } from "../services/ollama.js";
import { executeTool, toolDefinitionsForAI } from "../tools/registry.js";
import { buildSystemPrompt, extractMemory } from "../prompts/jarvis.js";
import {
  addMessage,
  createConversation,
  getConversation,
  listMessages,
} from "../database/conversations.js";
import { addMemory, listMemories } from "../database/memories.js";
import { listToolLogsForConversation } from "../database/toolLogs.js";

export const chatRouter = Router();

const HISTORY_MESSAGES = 20;
/** Old tool results can be long (a job list) → keep only the start; the AI just needs the gist. */
const OLD_TOOL_OUTPUT_CHARS = 400;

/**
 * 📘 LESSON: Show the AI the WHOLE story, not just the words
 * The messages table only stores what was SAID. If the history shows JARVIS saying
 * "Reminder set ✓" with no tool call before it, the small model learns "I can just SAY it's
 * done", and next time it confirms things it never did. 😱
 * So we put the tool calls back (from the tool_logs audit table) between each question and
 * its answer, in time order:  user → [tool call → tool result] → assistant.
 */
function buildHistory(conversationId: number): ChatMessage[] {
  const messages = listMessages(conversationId).slice(-HISTORY_MESSAGES);
  if (messages.length === 0) return [];
  const since = messages[0].created_at;
  const logs = listToolLogsForConversation(conversationId).filter((l) => l.created_at >= since);

  // Merge both lists by time. Same second → user message, then its tools, then the reply.
  type Item = { at: string; rank: number; msg?: (typeof messages)[number]; log?: (typeof logs)[number] };
  const items: Item[] = [
    ...messages.map((m) => ({ at: m.created_at, rank: m.role === "user" ? 0 : 2, msg: m })),
    ...logs.map((l) => ({ at: l.created_at, rank: 1, log: l })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.rank - b.rank));

  const out: ChatMessage[] = [];
  for (const item of items) {
    if (item.msg) {
      out.push({ role: item.msg.role, content: item.msg.content });
    } else if (item.log) {
      const l = item.log;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(l.args);
      } catch {
        /* keep {} */
      }
      const output = l.output.length > OLD_TOOL_OUTPUT_CHARS ? `${l.output.slice(0, OLD_TOOL_OUTPUT_CHARS)}…` : l.output;
      out.push({ role: "assistant", content: "", tool_calls: [{ function: { name: l.tool_name, arguments: args } }] });
      out.push({ role: "tool", tool_name: l.tool_name, content: l.ok ? output : `Failed: ${output}` });
    }
  }
  return out;
}

const chatBodySchema = z.object({
  conversationId: z.number().int().positive().optional(),
  message: z.string().trim().min(1).max(8000),
});

chatRouter.post("/", async (req, res) => {
  // 1. Validate
  const parsed = chatBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  const { conversationId, message } = parsed.data;

  // 2. Find the conversation, or create a new one titled with the first message
  let conversation;
  if (conversationId) {
    conversation = getConversation(conversationId);
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
  } else {
    const title = message.length > 50 ? message.slice(0, 50) + "…" : message;
    conversation = createConversation(title);
  }

  // 3. Save the user's message (+ a memory if they said "remember ...")
  addMessage(conversation.id, "user", message);
  const fact = extractMemory(message);
  if (fact) addMemory(fact);

  // 4. Build what we send to the AI: system prompt (with memories) + recent history WITH its tool calls
  const aiMessages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(listMemories().map((m) => m.content)) },
    ...buildHistory(conversation.id),
  ];

  // If the user presses Stop / closes the tab, cancel the Ollama request too.
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: "start", conversationId: conversation.id, memorySaved: fact });

  // 5. The AGENT LOOP 📘
  //    ask AI → if it requests tools: run them, give it the results, ask again → until it answers.
  //    MAX_ROUNDS stops an endless loop. On the last round we send NO tools, so it must answer in words.
  const MAX_ROUNDS = 3;
  const toolDefs = toolDefinitionsForAI();
  let reply = "";
  // 📘 Small models sometimes repeat the SAME tool call after seeing its result (→ two identical
  // reminders, the app opened twice). Within one message we run each exact call only once;
  // a repeat gets the earlier result back plus a nudge to answer now. ("idempotency")
  const alreadyRan = new Map<string, string>();
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const isLastRound = round === MAX_ROUNDS - 1;
      const requested: ToolCall[] = [];

      for await (const event of streamChat(aiMessages, isLastRound ? undefined : toolDefs, abort.signal)) {
        if (event.type === "token") {
          reply += event.token;
          send({ type: "token", token: event.token });
        } else {
          requested.push(...event.calls);
        }
      }
      if (requested.length === 0) break; // AI answered in words → finished

      // Remember that the AI asked for these tools, then run each one
      aiMessages.push({ role: "assistant", content: "", tool_calls: requested });
      for (const call of requested) {
        const { name, arguments: args } = call.function;
        const key = `${name}:${JSON.stringify(args ?? {})}`;
        const previous = alreadyRan.get(key);
        if (previous !== undefined) {
          console.log(`🔁 ${name} repeated with the same arguments → not run again`);
          aiMessages.push({
            role: "tool",
            tool_name: name,
            content: `${previous}\n(This was ALREADY done a moment ago. Do not call it again; just answer the user.)`,
          });
          continue;
        }
        send({ type: "tool", status: "running", name, args });
        const result = await executeTool(name, args, conversation.id);
        if (result.ok) alreadyRan.set(key, result.output);
        send({ type: "tool", status: result.ok ? "done" : "error", name, args, output: result.output });
        aiMessages.push({ role: "tool", tool_name: name, content: result.output });
      }
      if (abort.signal.aborted) break; // Stop pressed → don't continue
    }
    send({ type: "done" });
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error("Chat error:", err);
      send({ type: "error", error: err instanceof Error ? err.message : "Unknown error" });
    }
  } finally {
    // 6. Save whatever JARVIS said — even a partial reply if the user pressed Stop
    if (reply.trim()) addMessage(conversation.id, "assistant", reply);
    res.end();
  }
});
