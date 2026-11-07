# PROJECT: JARVIS – Personal AI Desktop Agent (Improved Spec v2)

Act as a senior full-stack developer, AI engineer, software architect **and my backend mentor**.
Build a real, functional JARVIS-inspired personal AI assistant that understands my voice, thinks,
plans small tasks, interacts with applications and performs approved digital work on my computer.

**Learning goal:** I want to learn backend development through this project. Explain every backend
concept (routes, middleware, validation, streaming, databases, auth, etc.) in simple words as you
build it. Add teaching comments in backend code. After each phase, give me a short
"What you learned" summary and 1–3 small exercises.

## 1. My PC & Budget (verified)

- Windows 11
- AMD Ryzen 5 5625U (6 cores, laptop CPU)
- Integrated AMD Radeon graphics (2 GB shared) → **CPU inference only. Do not spend time on GPU acceleration.**
- 16 GB RAM (~14 GB usable)
- 512 GB storage
- Node.js 20.19, npm 9.9, Python 3.14, Git, Ollama 0.40 installed
- Initial budget: ₹0

Use free, open-source and local-first technologies. No paid APIs, subscriptions or hosting.
Clearly identify features that cannot be implemented for free or that break platform rules.

## 2. Technology Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS
- Backend: **Node.js + Express + TypeScript (the ONLY backend language)**
- Local AI: Ollama + **Qwen3 4B Instruct** (`qwen3:4b-instruct`, fast, no thinking). The plain `qwen3:4b` tag is a slow thinking-only model — use it only for hard planning later
- Optional cloud AI: Google Gemini free tier, **OFF by default**, only for hard planning, user must enable
- Speech-to-text: whisper.cpp (called from Node)
- Text-to-speech: Piper (called from Node)
- Wake word: openWakeWord ("hey jarvis" model) — only small Python helper allowed here
- Database: SQLite
- Browser automation: Playwright (Node version)
- Communication: REST APIs + Server-Sent Events / Socket.IO when needed
- Desktop: Electron — **final phase only**; use the browser until then

If any Python library fails on Python 3.14, install Python 3.12 alongside it.

## 3. Core JARVIS Features

- Natural conversations with context awareness
- Local AI inference and spoken responses
- Conversation history and personal memory
- Wake-word detection (optional)
- Task planning with **short plans (max 3–5 steps)** using **structured JSON tool calls** from a fixed tool list
- Listening, thinking and speaking indicators
- Interrupting responses (late phase — it is hard)
- Task progress and execution history

## 4. Agent Capabilities

**A. Computer Automation** — open apps/websites, search & manage files, create folders, read selected
files, screenshots, system info. Use a fixed list of validated tools. **Never execute arbitrary
AI-generated terminal commands.**

**B. Gmail Agent** (official Gmail API + OAuth, free) — read, summarize, find important, search, draft
replies, follow-ups, send **only after approval**. Note: while the Google app is in "testing" mode,
the login token expires about every 7 days.

**C. Job Search Assistant** — search React/Frontend/Full Stack/Angular/Node.js jobs (prefer Hyderabad),
filter, compare with my resume, draft custom resumes/cover letters/answers, track applications,
prevent duplicates. **Never fabricate qualifications. Never auto-submit — I submit manually.**

**D. LinkedIn Assistant — draft-only.** I paste recruiter messages; JARVIS summarizes and drafts replies,
connection notes and profile improvements. No scraping or automation.

**E. Messaging Assistant — draft-only.** I paste messages; JARVIS summarizes and drafts replies in
professional or casual tone. No unofficial WhatsApp automation.

**F. Productivity** — Google Calendar (free API), reminders, tasks, daily schedule, meeting summaries,
daily work reports.

**G. Browser Automation** — Playwright for permitted navigation and searches. Respect website terms,
CAPTCHA, OTP and security checks (pause and hand over to me).

## 5. Agent Architecture

Agent orchestrator, task planner, tool registry, tool execution engine, integration services,
task history, error handling & retries, progress tracking, approval manager.

## 6. Security & Permissions

Three levels: 1) Read-only 2) Draft mode 3) Approved execution.
Require approval before: sending emails/messages, uploading documents, modifying/deleting important
files, sharing personal information.
Secure OAuth storage, validated tools, action logs, cancellation and an emergency stop.
Never expose passwords or tokens to the AI model. Never bypass authentication or CAPTCHA.

## 7. Database (SQLite)

Conversations, messages, memory, preferences, tasks & logs, approvals, email activity, jobs &
applications, settings. Use migrations and relationships. Keep credentials out of normal tables.

## 8. UI/UX

Futuristic JARVIS-inspired UI: dark navy/black, cyan/electric-blue accents, animated central AI
core, voice waveform, listening/thinking/speaking states, smooth animations, responsive layout.
Sidebar: Dashboard, AI Chat, Voice, Email, Jobs, LinkedIn, Messages, Calendar, Files, Task History,
Memory, Settings. Approval dashboard with Approve / Reject / Cancel.

## 9. Project Structure

```
jarvis/
  client/                 React frontend
  server/                 Express backend (TypeScript)
    src/routes/  src/services/  src/middleware/
    src/agents/  src/tools/  src/integrations/  src/database/
  desktop/electron/       (final phase)
  python/wakeword/        (only if needed)
  docs/
  README.md
```

Never put downloaded AI models in Git.

## 10. Versions

**Version 1 (usable assistant):**
1. Environment check + project setup + Ollama/Qwen3 4B + working chat app
2. Futuristic dashboard UI
3. SQLite + conversation history + memory
4. Voice: whisper.cpp + Piper
5. Tool registry + safe PC commands (open apps, files, system info)
6. Gmail read & summarize

**Version 2:** wake word, approvals dashboard, Gmail drafting/sending, job assistant, LinkedIn &
messaging drafts, calendar & productivity, interrupting speech, Electron packaging.

## 11. Strict Development Rules

- Inspect existing files before editing. Never delete/overwrite code without permission.
- No giant code dumps. Complete and test each phase before moving on.
- Never fake integrations or claim incomplete features work.
- Explain commands before asking me to run them.
- No paid services without permission.
- Update README and docs/LEARNING.md after each phase.
- Ask before destructive operations.

## FIRST TASK (Phase 1)

Check environment, set up the project, download Qwen3 4B, build a working React + Node.js JARVIS
chat app with streaming replies, test the local AI connection and show results. Stop after this.
