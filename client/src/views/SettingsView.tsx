import type { ReactNode } from "react";
import type { GmailStatus, Health, VoiceStatus } from "../api";
import { Panel } from "../components/Panel";

type Props = {
  health: Health | null;
  voice: VoiceStatus | null;
  gmail: GmailStatus | null;
  voiceReplies: boolean;
  onToggleVoice: () => void;
  onDisconnectGmail: () => void;
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-jarvis-cyan/5 py-3 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

const ok = (v: boolean | undefined, yes = "Ready", no = "Not available") =>
  v ? <span className="text-emerald-400">● {yes}</span> : <span className="text-red-400">● {no}</span>;

export function SettingsView({ health, voice, gmail, voiceReplies, onToggleVoice, onDisconnectGmail }: Props) {
  return (
    <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
      <Panel title="AI CORE">
        <Row label="Server">{ok(health !== null, "Online", "Offline")}</Row>
        <Row label="Ollama">{ok(health?.ollamaRunning, "Running", "Not running — open Ollama from Start menu")}</Row>
        <Row label="Model">
          <span className="font-mono text-xs text-jarvis-cyan">{health?.model ?? "—"}</span>
        </Row>
        <Row label="Runs on">Your laptop · 100% offline</Row>
      </Panel>

      <Panel title="VOICE">
        <Row label="Speech → text (Whisper)">{ok(voice?.speechToText)}</Row>
        <Row label="Text → speech (Piper)">{ok(voice?.textToSpeech)}</Row>
        <Row label="Speak replies out loud">
          <button
            onClick={onToggleVoice}
            disabled={!voice?.textToSpeech}
            className={`relative h-6 w-11 rounded-full transition disabled:opacity-40 ${voiceReplies ? "bg-jarvis-cyan/70" : "bg-slate-700"}`}
            aria-label="Toggle voice replies"
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${voiceReplies ? "left-5.5" : "left-0.5"}`}
            />
          </button>
        </Row>
        {voice && voice.missing.length > 0 && (
          <p className="mt-2 text-xs text-amber-300">Missing: {voice.missing.join(", ")} — see README “Voice setup”.</p>
        )}
      </Panel>

      <Panel title="GMAIL" className="md:col-span-2">
        {!gmail ? (
          <p className="text-sm text-slate-500">Checking…</p>
        ) : !gmail.configured ? (
          <p className="text-sm text-amber-300">
            Not set up — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to <code>server/.env</code> (README “Gmail setup”).
          </p>
        ) : gmail.connected ? (
          <>
            <Row label="Account">
              <span className="text-emerald-400">● {gmail.email}</span>
            </Row>
            <Row label="Permission">Read-only (cannot send or delete)</Row>
            <Row label="Note">Google ends test logins after 7 days → reconnect here</Row>
            <div className="pt-3 text-right">
              <button
                onClick={onDisconnectGmail}
                className="rounded-md border border-red-400/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
              >
                Disconnect Gmail
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-400">Let JARVIS read and summarize your emails (read-only).</p>
            <a
              href="/api/gmail/connect"
              className="shrink-0 rounded-md border border-jarvis-cyan/40 px-4 py-2 text-sm text-jarvis-cyan hover:bg-jarvis-cyan/10"
            >
              ✉ Connect Gmail
            </a>
          </div>
        )}
      </Panel>
    </div>
  );
}
