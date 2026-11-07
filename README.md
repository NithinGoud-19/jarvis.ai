# 🤖 J.A.R.V.I.S. — Personal AI Assistant

A free, local-first, Iron Man-inspired AI assistant. Runs fully on your laptop with Ollama.
Full spec: [docs/PROMPT.md](docs/PROMPT.md) · Backend lessons: [docs/LEARNING.md](docs/LEARNING.md)

## Requirements
- Node.js 20.19+
- [Ollama](https://ollama.com/download) with the model: `ollama pull qwen3:4b-instruct`

## Run
```bash
npm install            # root (installs "concurrently")
npm run install:all    # server + client packages
npm run dev            # starts backend (port 4000) + frontend (port 5173)
```
Open http://localhost:5173

## Voice setup (free, offline — ~245 MB, not in Git)
Run from the `server/` folder (Git Bash):
```bash
mkdir -p bin models
curl -L -o bin/whisper.zip https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip
curl -L -o bin/piper.zip   https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip
curl -L -o models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
curl -L -o models/en_GB-alan-medium.onnx      https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx
curl -L -o models/en_GB-alan-medium.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json
unzip bin/whisper.zip -d bin/whisper && unzip bin/piper.zip -d bin/piper && rm bin/*.zip
```
Check: http://localhost:4000/api/voice/status should say `"missing": []`.

## Gmail setup (free, read-only, ~10 minutes, one time)
1. Go to https://console.cloud.google.com → create a project named **JARVIS**.
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **Google Auth Platform** (or "OAuth consent screen") → **Get started**:
   app name `JARVIS`, your email as support + contact email, Audience: **External** → Create.
4. **Audience → Test users → Add users** → add your own Gmail address.
5. **Clients → Create client** → Application type: **Desktop app** → name `JARVIS Desktop` → Create.
6. Copy the **Client ID** and **Client secret** into `server/.env`:
   ```
   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxx
   ```
7. Restart the server → in JARVIS click **📧 Connect Gmail** → log in → you'll see
   "Google hasn't verified this app" → **Continue** (it's your own app) → tick the Gmail box → Continue.

Note: while the app is in "Testing" mode, Google expires the login after **7 days** → just click Connect Gmail again.

## Structure
```
jarvis/
  server/   Express + TypeScript backend (talks to Ollama)
    src/index.ts              app setup, middleware, routes
    src/config.ts             settings from .env
    src/routes/health.ts      GET  /api/health
    src/routes/chat.ts        POST /api/chat  (streaming SSE, saves to DB)
    src/routes/conversations.ts, memories.ts   REST routes
    src/database/db.ts        SQLite connection + runs migrations
    src/database/migrations.ts  table definitions (numbered steps)
    src/database/conversations.ts, memories.ts  repositories (all SQL lives here)
    src/tools/                tool registry + safe tools (apps, system, files)
    src/services/ollama.ts    Ollama API client (text + tool calls)
    src/services/voice.ts     whisper.cpp (speech→text) + Piper (text→speech)
    src/routes/voice.ts       /api/voice/* (binary audio in/out)
    bin/, models/             voice programs + models (downloaded, not in Git)
    src/integrations/google/  OAuth (hand-written) + Gmail API client
    data/secrets/             OAuth tokens (never in Git, never sent to browser/AI)
    data/jarvis.db            the database file (auto-created, not in Git)
    src/middleware/           404 + error handler
    src/prompts/jarvis.ts     JARVIS personality
  client/   React + Vite + Tailwind frontend
    src/App.tsx               shell: nav rail + top bar + pages (#/dashboard, #/chat …)
    src/views/                Dashboard, Chat, Email, Activity, Memory, Settings pages
    src/components/           Core (arc reactor), Panel (HUD), Gauge, NavRail, ToolChip
  docs/     spec + learning notes
```

## API
| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server + Ollama + model status |
| POST | `/api/chat` | Body `{ conversationId?, message }` → streams `start` (with `conversationId`), `token`…, `done`/`error` |
| GET | `/api/conversations` | List chats (newest first) |
| GET | `/api/conversations/:id` | One chat + its messages |
| PATCH | `/api/conversations/:id` | Rename: `{ title }` |
| DELETE | `/api/conversations/:id` | Delete chat + its messages |
| GET / POST | `/api/memories` | List / add `{ content }` |
| DELETE | `/api/memories/:id` | Forget a memory |
| GET | `/api/time` | Current time + day (built by you in Exercise 2 🎉) |
| GET | `/api/stats` | Counts of chats, messages, memories (built by you 🎉) |
| GET | `/api/tools` | Tools JARVIS may use |
| GET | `/api/tools/logs` | Audit log of tool calls (newest first) |
| GET | `/api/voice/status` | Are whisper/piper + models installed? |
| POST | `/api/voice/transcribe` | Body: WAV (`Content-Type: audio/wav`) → `{ text }` |
| POST | `/api/voice/speak` | Body `{ text }` → WAV audio |
| GET | `/api/gmail/status` | `{ configured, connected, email }` |
| GET | `/api/gmail/connect` | Redirects to Google login (OAuth) |
| GET | `/api/gmail/callback` | Google redirects back here with `code` + `state` |
| POST | `/api/gmail/disconnect` | Revoke + delete tokens |
| GET | `/api/gmail/messages?q=&max=` | Search emails (read-only) |
| GET | `/api/gmail/messages/:id` | One full email (reader) |
| GET | `/api/system` | Live CPU %, RAM, battery, uptime |

## Progress
- [x] Phase 1 — Project setup, Ollama + Qwen3 4B, streaming chat app
- [x] Phase 2 — Iron Man HUD UI: dashboard (live CPU/RAM/battery, inbox, activity, memory, quick actions), chat, email reader, activity log, memory manager, settings
- [x] Phase 3 — SQLite: chat history + memory
- [x] Phase 4 — Voice: 🎤 speak to JARVIS (whisper.cpp) + 🔊 British voice replies (Piper)
- [x] Phase 5 — Tool registry + safe PC commands (open apps/websites, search, battery, system info, list files)
- [x] Phase 6 — Gmail (read-only): Google OAuth, search, read & summarize emails
