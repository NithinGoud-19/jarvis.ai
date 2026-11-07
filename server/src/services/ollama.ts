/**
 * 📘 LESSON: Services
 * A "service" is a module that talks to something outside our app (an AI, a database,
 * Gmail...). Routes call services; routes should NOT know the details of Ollama's API.
 * If we switch to another AI later, we only change this file.
 */
import { config } from "../config.js";

export type ToolCall = {
  function: { name: string; arguments: Record<string, unknown> };
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_name: string };

/** What streamChat gives back: pieces of text, or a request to run tools. */
export type StreamEvent =
  | { type: "token"; token: string }
  | { type: "tool_calls"; calls: ToolCall[] };

/** Thrown when Ollama is unreachable or returns an error. */
export class OllamaError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

/** Checks Ollama is running and our model is downloaded. */
export async function checkOllama() {
  const res = await fetch(`${config.ollamaUrl}/api/tags`).catch(() => null);
  if (!res || !res.ok) {
    return { ollamaRunning: false, modelInstalled: false, model: config.ollamaModel };
  }
  const data = (await res.json()) as { models: { name: string }[] };
  const modelInstalled = data.models.some((m) => m.name === config.ollamaModel);
  return { ollamaRunning: true, modelInstalled, model: config.ollamaModel };
}

/**
 * 📘 LESSON: Streaming
 * The AI writes its answer word-by-word. Instead of waiting for the full answer, we
 * "stream": Ollama sends one JSON line per small piece, and we pass each piece on
 * immediately. `async function*` is an async generator — it can `yield` many values
 * over time, and the caller reads them with `for await`.
 *
 * If we pass `tools`, the AI may answer with "tool_calls" instead of text.
 */
export async function* streamChat(
  messages: ChatMessage[],
  tools: object[] | undefined,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollamaModel,
      messages,
      tools,
      stream: true,
      // We use the "instruct" edition of Qwen3, which answers directly (no slow
      // "thinking" step). The plain "qwen3:4b" tag is a thinking-only model.
      options: {
        num_ctx: 4096, // context window: smaller = less RAM + faster on CPU
      },
    }),
    signal,
  }).catch((err: unknown) => {
    if (signal?.aborted) throw err;
    throw new OllamaError("Cannot reach Ollama. Is it running?");
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new OllamaError(`Ollama error ${res.status}: ${text}`);
  }

  // Ollama sends "newline-delimited JSON": one JSON object per line.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // last piece may be an incomplete line — keep it

    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line) as {
        message?: { content?: string; tool_calls?: ToolCall[] };
        done?: boolean;
        error?: string;
      };
      if (chunk.error) throw new OllamaError(chunk.error);
      if (chunk.message?.content) yield { type: "token", token: chunk.message.content };
      if (chunk.message?.tool_calls?.length) {
        yield { type: "tool_calls", calls: chunk.message.tool_calls };
      }
      if (chunk.done) return;
    }
  }
}
