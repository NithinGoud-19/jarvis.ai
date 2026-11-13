# 📘 Backend Learning Notes

## Phase 1 — Your first backend

### 1. What is a backend?
The browser (frontend) cannot talk to Ollama safely or control your PC. The **backend** is a
program that runs on your machine, receives **HTTP requests** from the frontend, does the work
(talk to AI, database, files), and sends back **responses**.

```
Browser (React)  --HTTP-->  Express server (:4000)  --HTTP-->  Ollama (:11434)
```

### 2. Concepts used (find them in `server/src/`)
| Concept | File | One-line meaning |
|---|---|---|
| Environment config | `config.ts` | Settings come from `.env`, not hard-coded |
| Routes | `routes/*.ts` | Method + path + handler, e.g. `POST /api/chat` |
| Router | `routes/*.ts` | Groups related routes; mounted with `app.use("/api/chat", chatRouter)` |
| Middleware | `index.ts`, `middleware/` | Functions that run on every request (CORS, JSON parse, logger) |
| Error handling | `middleware/errorHandler.ts` | One central place for 404 and 500 responses |
| Validation | `routes/chat.ts` (zod) | Never trust client data; reject bad input with 400 |
| Service layer | `services/ollama.ts` | Code that talks to outside systems, separate from routes |
| Streaming (SSE) | `routes/chat.ts` | Send many small messages over one open response |
| Cancellation | `AbortController` | If the user presses Stop, cancel the AI request too |
| Security | `index.ts` | Server listens on `127.0.0.1` only, not your Wi-Fi |

### 3. HTTP status codes you'll meet
- `200` OK · `400` bad input (your fault, client) · `404` not found · `500` server bug · `502` upstream (Ollama) failed

### 4. Real debugging story from Phase 1
The first test reply took **78 seconds** and was full of the AI's "inner thoughts".
- **Observe:** the output ended with `</think>`, so the model was reasoning before answering.
- **Hypothesis 1:** `think: false` should turn that off → tested, still thinking ❌
- **Hypothesis 2:** `/no_think` in the message → tested, still thinking ❌
- **Investigate:** `ollama show qwen3:4b` → `thinking: default true`, context 262144 → this tag is the
  newer *thinking-only* edition.
- **Fix:** use `qwen3:4b-instruct` → reply in **1.6 s** ✅
- **Lesson:** don't guess. Test one idea at a time, read the tool's own information, and measure before and after.
  Also: because the model name lives in `.env`/`config.ts`, the fix was a one-line config change.

### 5. Try it yourself (exercises)
1. Open http://localhost:4000/api/health in the browser. Read the JSON. Stop Ollama and refresh — what changes?
2. Add a new route `GET /api/time` that returns `{ "time": "<current time>" }`.
   Hint: copy `routes/health.ts`, then mount it in `index.ts`.
3. Send bad data and see validation work (PowerShell):
   ```powershell
   Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/chat -ContentType "application/json" -Body '{"messages":[]}'
   ```
   You should get a `400` error. Why? (The chat route checks the input with zod and rejects it.)
   *(Since Phase 3 the chat body is `{ "message": "..." }`, so try `-Body '{"message":""}'`.)*

---

## Phase 3 — Database (SQLite)

### 1. Why a database?
Before Phase 3, chats lived only in the browser's memory → refresh = everything gone.
A **database** stores data on disk, so it survives refreshes and restarts.
**SQLite** = the whole database is ONE file: `server/data/jarvis.db`. Free, no server needed.

### 2. Our tables
```
conversations                messages                          memories
-------------                --------                          --------
id  (PRIMARY KEY)  ◄───┐     id                                id
title                  └──── conversation_id (FOREIGN KEY)     content
created_at                   role  ('user' | 'assistant')      created_at
updated_at                   content
                             created_at
```
One conversation → **many** messages. That is a "one-to-many relationship".

### 3. Concepts used (find them in `server/src/database/`)
| Concept | File | One-line meaning |
|---|---|---|
| Migration | `migrations.ts` | Numbered schema changes, each runs once. Never edit old ones — add new ones |
| Connection | `db.ts` | Open the DB file once, reuse it everywhere |
| Repository | `conversations.ts`, `memories.ts` | All SQL for a table in one file; routes call simple functions |
| CRUD | repositories | `INSERT` create · `SELECT` read · `UPDATE` update · `DELETE` delete |
| `?` placeholders | everywhere | Stop **SQL injection**: values never become SQL code |
| Transaction | `addMessage()`, migrations | Several writes, all-or-nothing |
| Foreign key + CASCADE | `migrations.ts` | Delete a chat → its messages are deleted automatically |
| Index | `migrations.ts` | Makes "messages of conversation X" fast |

### 4. API design you learned (REST)
| Status | Meaning | Where |
|---|---|---|
| `200` OK | success with data | GET routes |
| `201` Created | POST made something new | `POST /api/memories` |
| `204` No Content | success, nothing to return | DELETE routes |
| `400` Bad Request | invalid input (e.g. id = "abc") | all routes |
| `404` Not Found | that id doesn't exist | `/api/conversations/999` |

### 5. Server = source of truth
Phase 1: browser sent the whole history every time. Phase 3: browser sends only
`{ conversationId, message }`; the server loads history from the DB. Smaller requests, and
the client can't fake history.

### 6. Exercises
1. **Look inside the database.** In VS Code, install the free extension **"SQLite Viewer"**,
   then click `server/data/jarvis.db`. Chat with JARVIS and watch rows appear.
2. **Read with SQL.** Open http://localhost:4000/api/conversations — this runs
   `SELECT * FROM conversations ORDER BY updated_at DESC`. Find that line in `conversations.ts`.
3. **Your own route (challenge):** add `GET /api/stats` that returns
   `{ "conversations": 3, "messages": 12, "memories": 2 }`.
   Hint: `db.prepare("SELECT COUNT(*) AS n FROM messages").get()` returns `{ n: 12 }`.
   Make a new repository function, then a new route file, then mount it in `index.ts`.
   ✅ *Done by you as `/api/stats`!*

---

## Phase 5 — Tools: JARVIS can DO things

### 1. The big idea: the AI only ASKS, the backend DECIDES
```
You: "Open Chrome"
  → backend sends AI: your message + the MENU of tools (name, description, arguments)
  → AI replies: "call open_app({ app: 'chrome' })"          ← just a request, not code
  → backend: known tool? valid arguments? → run OUR code → log it
  → backend sends AI: "result: Opened Google Chrome."
  → AI replies: "Chrome is open, Sir."
```
This loop is called an **agent loop** (`routes/chat.ts`). It runs at most 3 rounds, so it can never loop forever.

### 2. Files (`server/src/tools/`)
| File | Job |
|---|---|
| `types.ts` | What a tool looks like: name, description, permission, zod schema, run() |
| `registry.ts` | The ONE list of allowed tools + `executeTool()` gatekeeper + logging |
| `system.ts` | Read tools: time, system info, battery |
| `apps.ts` | Action tools: open app (allowlist), open website, web search |
| `files.ts` | Read tool: list desktop / documents / downloads |
| `exec.ts` | Safe way to start programs (`execFile`, no shell, timeout) |
| `database/toolLogs.ts` | Audit log of every tool call |

### 3. Security rules we followed 🛡️
| Rule | Why |
|---|---|
| **Allowlist**, not blocklist | We list what IS allowed (8 apps). Anything else is refused. You can't forget to block something. |
| **Validate AI output** with zod | The AI can be wrong or tricked. Treat its tool requests like user input. |
| `execFile`, never `exec` | No shell → `&`, `;`, `\|` can't chain extra commands. |
| Only `http/https` URLs | Blocks `file:///C:/...` and `javascript:` |
| Audit log | Always know what JARVIS did and when (`GET /api/tools/logs`) |
| Read vs action permission | Prepares for Version 2: action tools will need your approval |

Our tests blocked all 6 attacks, e.g. `open_app({ app: "chrome'; Remove-Item C:/fake; '" })` →
*"Invalid option: expected one of chrome|edge|..."*

### 4. New concepts
- **JSON Schema**: `z.toJSONSchema()` turns our zod schema into the format the AI reads. One source of truth.
- **`ON DELETE SET NULL`** (migration 2): delete a chat → its tool logs stay, with `conversation_id = null`.
- **Async generator events**: `streamChat` now yields `token` OR `tool_calls` events.

### 5. Exercises
1. **Easy — add an app.** In `tools/apps.ts`, add a line to `APPS`, e.g.
   `paint: { label: "Paint", target: "mspaint" },` → save → ask JARVIS "open paint".
   (The AI learns about it automatically. Why? Look at `description` in `openApp`.)
2. **See the audit log:** open http://localhost:4000/api/tools/logs
3. **Challenge — build a new tool `get_disk_space`** (read-only) that returns free GB on drive C:.
   Hint: copy `getBattery` in `system.ts`, use this FIXED PowerShell script:
   `Get-PSDrive C | Select-Object Used,Free | ConvertTo-Json` (values are in bytes), then add it to
   the `TOOLS` array in `registry.ts`.

---

## Phase 4 — Voice 🎤🔊

### 1. The full voice loop
```
🎤 Browser records mic → builds a WAV file (client/src/lib/recorder.ts)
   → POST /api/voice/transcribe   (binary audio)
   → server saves temp file → runs whisper-cli.exe → "open chrome"
   → POST /api/chat               (same as typing!)
   → reply text streams in
   → POST /api/voice/speak        { text }
   → server runs piper.exe → WAV bytes back → browser plays them 🔊
```
Notice: voice did NOT change the chat route at all. Voice is just a different way to
produce and consume TEXT. Good design = small pieces that plug together.

### 2. New backend concepts
| Concept | Where | Meaning |
|---|---|---|
| **Binary data** | `routes/voice.ts` | Audio is raw bytes, not text. In Node, raw bytes = `Buffer` |
| **Content-Type** | `routes/voice.ts` | Header that says what the bytes are: `application/json` vs `audio/wav` |
| `express.raw()` | `routes/voice.ts` | Body parser for binary. Used **only on one route** (route-level middleware) |
| **Upload validation** | `routes/voice.ts` | Real WAV files start with `RIFF`. Check "magic bytes", never trust uploads |
| **stdin** | `services/voice.ts` | Piper reads text from standard input, like typing into it |
| **Temp files** | `services/voice.ts` | Unique names (`randomUUID`) + always delete in `finally` |
| `next(err)` | `routes/voice.ts` | Pass errors to the central error handler → 500 |
| **Sending binary** | `res.type("audio/wav").send(buffer)` | Response is sound, not JSON |

### 3. Why build the WAV in the browser?
Browsers record WebM/Opus. whisper.cpp can't read that. Options:
- Install ffmpeg on the server to convert (another 100 MB program), or
- Capture raw samples in the browser and write the 44-byte WAV header ourselves ✅
  (Open `recorder.ts` → `encodeWav()` — every byte of the header is explained.)

### 4. Speed on your laptop
| Step | Time |
|---|---|
| Whisper (speech → text, few seconds of audio) | ~1 s |
| AI reply | ~2–5 s |
| Piper (text → speech) | ~1 s |

### 5. Exercises
1. **Try the API without the browser** (PowerShell) — make JARVIS say anything:
   ```powershell
   Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/voice/speak -ContentType "application/json" -Body '{"text":"Hello Sir, I am learning backend"}' -OutFile hello.wav; start hello.wav
   ```
2. **Change the voice.** Browse voices at https://rhasspy.github.io/piper-samples/ (try `en_US-ryan-high`
   or `en_GB-northern_english_male-medium`), download the `.onnx` + `.onnx.json` into `server/models/`,
   then set `PIPER_MODEL=models/<name>.onnx` in `server/.env`. Restart. (Lesson: config via `.env`!)
3. **Challenge:** open `services/voice.ts` and find `cleanForSpeech()`. Make JARVIS say
   "percent" when the text has "%" (e.g. "100%" → "100 percent").

---

## Phase 6 — Gmail & OAuth 📧🔐

### 1. Why OAuth? (never ask for passwords)
Bad old way: "Give JARVIS your Gmail password." If JARVIS leaks it, your whole Google account is gone.
**OAuth way:** you log in **at Google**. Google gives JARVIS a **token** that can ONLY do what you allowed
(here: *read* Gmail). You can cancel it any time at https://myaccount.google.com/permissions

### 2. The flow (see `integrations/google/oauth.ts`)
```
Browser                     JARVIS backend                     Google
  │ click Connect Gmail ──────► /api/gmail/connect
  │                             makes state + PKCE
  │ ◄────────── 302 redirect to accounts.google.com ──────────►│ login + "Allow"
  │ ◄──────────────────────────────── 302 /api/gmail/callback?code=…&state=…
  │                             check state ✔
  │                             POST code+secret+verifier ────►│
  │                             ◄──── access_token + refresh_token
  │                             save to data/secrets/ (NOT DB, NOT browser)
  │ ◄── 302 back to the app (?gmail=connected)
```

### 3. Words to know
| Word | Meaning |
|---|---|
| **Client ID** | Public name of our app at Google |
| **Client secret** | Our app's password at Google → only in `.env` |
| **Scope** | What we ask permission for. We use only `gmail.readonly` (**least privilege**) |
| **Authorization code** | One-time ticket Google gives back after login |
| **Access token** | Key used on every API call (`Authorization: Bearer …`), lasts ~1 hour |
| **Refresh token** | Long-lived key used to get new access tokens |
| **state** | Random value we check on return → blocks **CSRF** (a fake login link) |
| **PKCE** | Proves the same app that started the login finishes it → a stolen code is useless |
| **Redirect (302)** | Server tells browser "go to this other URL" |
| **Revoke** | Tell Google to cancel a token (our Disconnect button) |

### 4. Security in this phase
- Tokens: own file, never in DB, never in Git, never sent to browser or AI.
- Read-only scope: even a bug can't send or delete emails.
- **Prompt injection**: emails are written by strangers. We label email text as untrusted data
  and tell the AI never to follow instructions inside emails (`tools/gmail.ts`, `prompts/jarvis.ts`).
- Our test: a fake callback with a "stolen" code + wrong state → rejected ✅

### 5. Exercises
1. After connecting, open http://localhost:4000/api/gmail/messages?q=is:unread&max=5 — raw JSON from your own API.
2. Find where the `Authorization: Bearer` header is added (`integrations/google/gmail.ts`). Why must tokens stay secret?
3. Open `server/data/secrets/google-oauth.json` — see your tokens. Then click Disconnect and check the file is gone.
4. **Challenge:** add a tool `gmail_count_unread` that returns just the number of unread emails.
   Hint: `searchEmails("is:unread", 10)` gives a list — or look up the Gmail API `labels/UNREAD` endpoint
   (`messagesUnread` field).

---

## V2 · Feature 1 — Reminders & to-do list ⏰

### 1. The flow
```
"Remind me to call mom at 6 pm"
   → AI calls task_add { text: "call mom", when: "at 6 pm" }   (copies your words, no maths)
   → services/timeParse.ts (chrono-node) → 6:00 pm today       (CODE does the date maths)
   → tasks table (due_at in UTC)
   → scheduler checks every 15 s: due_at <= datetime('now') ?
   → Windows pop-up (PowerShell toast) + SSE event → banner + JARVIS speaks it
```

### 2. New backend concepts
| Concept | Where | In one line |
|---|---|---|
| **Background job / scheduler** | `services/reminders.ts` | Code that runs because TIME passed, not because a request came |
| **Server-Sent Events (SSE)** | `services/events.ts`, `routes/events.ts` | One long GET request the server keeps writing to → live push to the browser |
| **Service layer** | `services/tasks.ts` | Rules live in ONE place, used by both the REST routes and the AI tools |
| **Store UTC, show local** | `database/tasks.ts` | Comparing times stays a simple SQL condition |
| **Partial index** | migration 6 | An index with a WHERE: only rows the scheduler needs |
| **Atomic "take"** | `takeDueReminders()` | Select + mark as fired in one transaction → never fires twice |
| **PATCH** | `PATCH /api/tasks/:id` | Change only the fields you send |
| **Idempotency** | `routes/chat.ts` | The same tool call twice in one message runs only once |

### 3. Two AI lessons learned while testing 🐛
1. **The small model repeated `task_add`** → two identical reminders. Fix: the agent loop remembers
   which exact calls it already ran in this message and returns the old result instead.
2. **The model said "Added ✓" WITHOUT calling the tool.** Why? The history only stored the
   WORDS of past replies, so it looked like JARVIS had just *said* "done" before. Fix: `buildHistory()`
   puts the tool calls back (from the `tool_logs` audit table) between each question and answer.
   Lesson: **an AI copies the patterns it sees in its history, so show it the whole truth.**

### 4. Exercises
1. Add a `GET /api/tasks/upcoming` route that returns only reminders due in the next 24 hours.
2. Change "Snooze 10m" to offer 5 / 10 / 30 minutes.
3. Hard: repeating reminders ("every day at 9 am"). Hint: add a `repeat` column; when a reminder
   fires, instead of leaving it fired, move `due_at` forward by one day and clear `notified_at`.
4. Open two JARVIS tabs and add a task in one. Why does the other tab update by itself?
