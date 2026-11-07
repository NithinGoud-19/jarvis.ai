import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { Conversation, Message, VoiceStatus } from "../api";
import { Core, type CoreState } from "../components/Core";
import { Panel } from "../components/Panel";
import { ToolChip } from "../components/ToolChip";
import { Recorder } from "../lib/recorder";

type Props = {
  online: boolean;
  voice: VoiceStatus | null;
  voiceReplies: boolean;
  /** A command sent from another page (e.g. Dashboard quick actions) */
  command: { id: number; text: string } | null;
  onCommandTaken: () => void;
  onStateChange: (s: CoreState) => void;
  onActivity: () => void;
};

export function ChatView(props: Props) {
  const { online, voice, voiceReplies } = props;
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [input, setInput] = useState("");
  const [state, setStateRaw] = useState<CoreState>("idle");
  const [level, setLevel] = useState(0);
  const [mic, setMic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Cancels the CURRENT speech: both "still creating the voice" and "playing it"
  const speechAbortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const setState = (s: CoreState) => {
    setStateRaw(s);
    props.onStateChange(s);
  };

  const refreshConversations = () => {
    api.listConversations().then(setConversations).catch(() => {});
    props.onActivity();
  };

  useEffect(refreshConversations, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // While listening, read the mic volume ~60 times a second to animate the core
  useEffect(() => {
    if (state !== "listening") return;
    let frame = 0;
    const tick = () => {
      setLevel(recorderRef.current?.level ?? 0);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [state]);

  const busy = state !== "idle" && state !== "offline" && state !== "listening";
  const canListen = !!voice?.speechToText;
  const canSpeak = !!voice?.textToSpeech;

  // Commands from the Dashboard ("Summarize my unread emails" etc.)
  useEffect(() => {
    if (!props.command || busy || state === "listening") return;
    const text = props.command.text;
    props.onCommandTaken();
    newChat();
    void send(text);
  }, [props.command]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openConversation(id: number) {
    setError(null);
    try {
      const c = await api.getConversation(id);
      setConversationId(c.id);
      setMessages(c.messages.map(({ role, content }) => ({ role, content })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setError(null);
    setNotice(null);
  }

  async function removeConversation(id: number) {
    if (!confirm("Delete this chat permanently?")) return;
    await api.deleteConversation(id).catch((e) => setError(String(e)));
    if (id === conversationId) newChat();
    refreshConversations();
  }

  /** Stop everything: the AI stream and JARVIS's voice. */
  function stopAll() {
    abortRef.current?.abort();
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setState("idle");
  }

  /** 🎤 First click: start recording. Second click: stop, transcribe, send. */
  async function toggleMic() {
    setError(null);
    if (state === "listening") {
      const recorder = recorderRef.current!;
      recorderRef.current = null;
      const { wav, seconds } = await recorder.stop();
      if (seconds < 0.5) {
        setState("idle");
        return;
      }
      setState("transcribing");
      try {
        const { text, silent } = await api.transcribe(wav);
        if (silent) {
          setState("idle");
          setError(
            `🎤 Your microphone recorded silence (${mic ?? "unknown mic"}). ` +
              "Check: 1) Lenovo mic-mute key (F4) light is OFF · 2) Windows Settings → Sound → Input → " +
              "volume is up and the bar moves when you speak · 3) Chrome 🔒 icon → Microphone → allowed, correct mic selected.",
          );
          return;
        }
        if (!text) {
          setState("idle");
          setNotice("🎤 I didn't catch that, Sir. Please try again.");
          return;
        }
        await send(text);
      } catch (err) {
        setState("idle");
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    stopAll(); // talking over JARVIS interrupts him
    try {
      const recorder = new Recorder();
      await recorder.start();
      recorderRef.current = recorder;
      setMic(recorder.micName || null);
      setNotice(null);
      setState("listening");
    } catch {
      setError("Microphone blocked. Allow microphone access in the browser (🔒 icon in the address bar).");
    }
  }

  async function playVoice(text: string) {
    if (!canSpeak || !text.trim()) return;
    const ctrl = new AbortController();
    speechAbortRef.current = ctrl;
    setState("talking");
    try {
      const blob = await api.speak(text, ctrl.signal);
      if (ctrl.signal.aborted) return; // cancelled while the voice was being created → never play
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      await new Promise<void>((resolve) => {
        audio.onended = audio.onpause = () => resolve();
        audio.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
    } catch {
      /* cancelled, or voice failed — the text is already on screen */
    } finally {
      // Only reset if THIS speech is still the current one (see Phase 4 bug fix)
      if (speechAbortRef.current === ctrl) {
        speechAbortRef.current = null;
        audioRef.current = null;
        setState("idle");
      }
    }
  }

  async function send(spokenText?: string) {
    const text = (spokenText ?? input).trim();
    if (!text || (busy && !spokenText)) return;
    if (!spokenText) setInput("");
    setError(null);
    setNotice(null);

    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setState("thinking");

    const abort = new AbortController();
    abortRef.current = abort;
    let reply = "";
    try {
      await api.streamChat(
        { conversationId: conversationId ?? undefined, message: text },
        {
          onStart: ({ conversationId: id, memorySaved }) => {
            setConversationId(id);
            if (memorySaved) setNotice(`🧠 Saved to memory: “${memorySaved}”`);
          },
          onTool: (activity) => {
            setState("thinking");
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              const tools = [...(last.tools ?? [])];
              // "done"/"error" replaces the matching "running" chip
              const i = tools.findIndex((t) => t.name === activity.name && t.status === "running");
              if (i >= 0 && activity.status !== "running") tools[i] = activity;
              else tools.push(activity);
              copy[copy.length - 1] = { ...last, tools };
              return copy;
            });
          },
          onToken: (token) => {
            reply += token;
            setState("responding");
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = { ...last, content: last.content + token };
              return copy;
            });
          },
        },
        abort.signal,
      );
    } catch (err) {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      // Drop an empty assistant bubble if nothing came back
      setMessages((prev) => (prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev));
      abortRef.current = null;
      refreshConversations();
    }

    if (voiceReplies && reply && !abort.signal.aborted) await playVoice(reply);
    else setState("idle");
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* Conversation list */}
      <Panel
        title="CONVERSATIONS"
        className="hidden w-64 shrink-0 md:flex"
        right={
          <button
            onClick={newChat}
            disabled={busy || state === "listening"}
            className="rounded border border-jarvis-cyan/40 px-2 py-0.5 text-[11px] text-jarvis-cyan hover:bg-jarvis-cyan/10 disabled:opacity-40"
          >
            + New
          </button>
        }
      >
        <div className="-m-2 h-[calc(100%+1rem)] overflow-y-auto">
          {conversations.length === 0 && <p className="p-2 text-xs text-slate-500">No saved chats yet.</p>}
          <ul className="space-y-0.5">
            {conversations.map((c) => (
              <li key={c.id} className="group flex items-center">
                <button
                  onClick={() => openConversation(c.id)}
                  disabled={busy || state === "listening"}
                  className={`flex-1 truncate rounded px-2 py-1.5 text-left text-sm disabled:opacity-60 ${
                    c.id === conversationId ? "bg-jarvis-cyan/15 text-jarvis-cyan" : "text-slate-300 hover:bg-white/5"
                  }`}
                  title={c.title}
                >
                  {c.title}
                </button>
                <button
                  onClick={() => removeConversation(c.id)}
                  disabled={busy}
                  className="px-1.5 text-slate-500 opacity-0 hover:text-red-400 group-hover:opacity-100"
                  aria-label="Delete chat"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      {/* Chat */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex justify-center">
          <Core state={online ? state : "offline"} level={level} size={120} />
        </div>

        <Panel className="flex-1" scan={state === "thinking"}>
          <div className="-m-1 h-[calc(100%+0.5rem)] space-y-3 overflow-y-auto pr-1">
            {messages.length === 0 && (
              <div className="pt-8 text-center">
                <p className="font-hud text-sm tracking-[0.2em] text-jarvis-cyan/80">AT YOUR SERVICE, SIR</p>
                <p className="mt-2 text-xs text-slate-500">
                  Type below{canListen ? " or click 🎤 to speak" : ""}. Try: “Open VS Code” · “Battery status?” ·
                  “Summarize my unread emails”
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`fade-up ${m.role === "user" ? "text-right" : "text-left"}`}>
                {m.tools && m.tools.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                    {m.tools.map((t, j) => (
                      <ToolChip key={j} tool={t} />
                    ))}
                  </div>
                )}
                <div
                  className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-left text-sm leading-relaxed ${
                    m.role === "user"
                      ? "border border-jarvis-blue/40 bg-jarvis-blue/20 text-white"
                      : "border border-jarvis-cyan/25 bg-black/35 text-slate-200"
                  }`}
                >
                  {m.content || <span className="animate-pulse text-jarvis-cyan">▍</span>}
                </div>
              </div>
            ))}
            {notice && <p className="text-xs text-emerald-400">{notice}</p>}
            {error && <p className="text-sm text-red-400">⚠ {error}</p>}
            <div ref={bottomRef} />
          </div>
        </Panel>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {canListen && (
            <button
              type="button"
              onClick={toggleMic}
              disabled={(busy && state !== "talking") || !online}
              className={`rounded-lg border px-4 text-lg transition disabled:opacity-40 ${
                state === "listening"
                  ? "animate-pulse border-emerald-400 bg-emerald-400/20 shadow-[0_0_16px_rgba(52,211,153,0.5)]"
                  : "border-jarvis-cyan/40 hover:bg-jarvis-cyan/10 hover:shadow-[0_0_12px_rgba(34,211,238,0.35)]"
              }`}
              title={state === "listening" ? "Click when you finish speaking" : "Click and speak"}
              aria-label="Microphone"
            >
              {state === "listening" ? "⏹" : "🎤"}
            </button>
          )}
          <input
            className="flex-1 rounded-lg border border-jarvis-cyan/30 bg-black/40 px-4 py-3 text-sm outline-none transition focus:border-jarvis-cyan focus:shadow-[0_0_12px_rgba(34,211,238,0.25)]"
            placeholder={
              state === "listening" ? `Listening on ${mic ?? "microphone"}… click ⏹ when you finish` : "Speak to JARVIS…"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={state === "listening"}
            autoFocus
          />
          {busy ? (
            <button
              type="button"
              onClick={stopAll}
              className="rounded-lg border border-red-400/50 px-5 text-sm text-red-300 hover:bg-red-500/10"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || state === "listening"}
              className="rounded-lg bg-jarvis-cyan/20 px-5 font-hud text-xs tracking-widest text-jarvis-cyan hover:bg-jarvis-cyan/30 disabled:opacity-40"
            >
              SEND
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
