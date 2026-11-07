/**
 *   GET  /api/voice/status       → are the voice programs installed?
 *   POST /api/voice/transcribe   → body: WAV audio (binary)  → { text }
 *   POST /api/voice/speak        → body: { text }            → WAV audio (binary)
 *
 * 📘 LESSON: Binary data & Content-Type
 * Until now every request/response was JSON TEXT. Audio is BINARY (raw bytes).
 * The "Content-Type" header tells each side what the bytes are:
 *   application/json → text we can JSON.parse
 *   audio/wav        → sound bytes
 * express.json() only reads JSON, so for audio we use express.raw(), which gives
 * us req.body as a Buffer (Node's type for raw bytes).
 */
import express, { Router } from "express";
import { z } from "zod";
import { measureVolume, speak, transcribe, voiceStatus } from "../services/voice.js";

export const voiceRouter = Router();

voiceRouter.get("/status", (_req, res) => {
  res.json(voiceStatus());
});

// Route-level middleware: only THIS route accepts raw audio (max 10 MB ≈ 5 minutes)
voiceRouter.post("/transcribe", express.raw({ type: "audio/wav", limit: "10mb" }), async (req, res, next) => {
  const audio = req.body;
  // A real WAV file always starts with the 4 bytes "RIFF". Check it — never trust uploads.
  if (!Buffer.isBuffer(audio) || audio.length < 44 || audio.subarray(0, 4).toString() !== "RIFF") {
    res.status(400).json({ error: "Send a WAV file with Content-Type: audio/wav" });
    return;
  }
  try {
    const start = Date.now();
    const seconds = ((audio.length - 44) / 32000).toFixed(1); // 16 kHz × 2 bytes per sample
    const { peak, rms } = measureVolume(audio);
    const volume = `peak ${(peak * 100).toFixed(1)}%, avg ${(rms * 100).toFixed(2)}%`;

    // Almost silent? Don't ask Whisper — on silence it invents words like "you".
    if (peak < 0.02) {
      console.log(`🎤 SILENT recording (${seconds}s, ${volume}) — microphone not picking up sound`);
      res.json({ text: "", silent: true, peak });
      return;
    }

    const text = await transcribe(audio);
    console.log(`🎤 Heard (${seconds}s, ${volume}, ${Date.now() - start} ms): "${text}"`);
    res.json({ text, silent: false, peak });
  } catch (err) {
    next(err); // → errorHandler middleware (500)
  }
});

const speakSchema = z.object({ text: z.string().trim().min(1).max(3000) });

voiceRouter.post("/speak", async (req, res, next) => {
  const body = speakSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const wav = await speak(body.data.text);
    res.type("audio/wav").send(wav); // send raw bytes, not JSON
  } catch (err) {
    next(err);
  }
});
