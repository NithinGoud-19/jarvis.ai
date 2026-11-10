/**
 * 📘 LESSON: Configuration
 * Never hard-code settings (ports, URLs, secrets) inside your code.
 * We read them from "environment variables" (process.env), which come from
 * the .env file. This way the same code runs on any machine with different settings.
 */
import "dotenv/config"; // loads .env into process.env

export const config = {
  port: Number(process.env.PORT ?? 4000),
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "qwen3:4b-instruct",
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  // SQLite database file (one file = whole database). Ignored by Git.
  dbPath: process.env.DB_PATH ?? "data/jarvis.db",
  // Voice programs + models (downloaded, not in Git). See README "Voice setup".
  whisperBin: process.env.WHISPER_BIN ?? "bin/whisper/Release/whisper-cli.exe",
  whisperModel: process.env.WHISPER_MODEL ?? "models/ggml-base.en.bin",
  piperBin: process.env.PIPER_BIN ?? "bin/piper/piper/piper.exe",
  piperModel: process.env.PIPER_MODEL ?? "models/en_GB-alan-medium.onnx",
  // Google OAuth "Desktop app" client (free) — see README "Gmail setup". SECRET: only in .env!
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  // Job form-filler (Playwright). "msedge" = the Edge already on Windows (no extra download).
  browserChannel: process.env.BROWSER_CHANNEL ?? "msedge",
  // Hidden browser — only for automated tests. Normally the window is visible so you can review + submit.
  applyHeadless: process.env.APPLY_HEADLESS === "1",
};
