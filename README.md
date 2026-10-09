# Windows Floating Assistant

A Windows-only Electron + React overlay with live audio transcription, screenshot questions, streamed answers, interview context, persistent per-user profiles/history, and a TypeScript/PostgreSQL backend.

## Architecture

```text
React renderer
  -> context-isolated preload IPC
  -> Electron main services
  -> authenticated HTTPS API
  -> Fastify + Drizzle ORM
  -> PostgreSQL
  -> server-side AI provider
```

The renderer never receives the backend session token or AI provider key. Electron main stores the opaque, revocable session token using Windows-backed Electron `safeStorage`. PostgreSQL is authoritative for accounts, profiles, interviews, completed turns, and usage metadata. Existing Phase 1 local data is not uploaded.

## Requirements

- Windows 10/11
- Node.js 20 or newer
- PostgreSQL 14 or newer
- An AI provider API key configured only for the backend

## First-time setup

```powershell
cd D:\project
npm.cmd install
npm.cmd install --prefix server
Copy-Item .env.example .env
Copy-Item server\.env.example server\.env
```

Create the PostgreSQL database. Keep only non-secret client URLs in root `.env`:

```dotenv
API_BASE_URL=http://localhost:3001
```

Put backend-only configuration in `server\.env`:

```dotenv
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/floating_assistant
AI_PROVIDER_KEY=your_server_side_key
```

Never commit either `.env` file. Electron deliberately allow-lists only its three non-secret client settings when reading the root file; it does not load backend variables. Apply the checked-in migration:

```powershell
cd D:\project
npm.cmd run db:migrate
npm.cmd --prefix server run db:verify
```

## Run locally

Use two terminals:

```powershell
# Terminal 1
cd D:\project
npm.cmd run share-server
```

```powershell
# Terminal 2
cd D:\project
npm.cmd run dev
```

`run.bat` installs missing dependencies and starts both processes. PostgreSQL must already be running and migrated.

## Tests and builds

```powershell
cd D:\project
npm.cmd test
npm.cmd run build

cd D:\project\server
npm.cmd test
npm.cmd run build
```

Backend tests cover authentication, session revocation, password reset, verification, beta invites, resource isolation, exports/deletion, AI limits, health checks, usage accounting, interview history, configuration validation, and fresh migration initialization.

## API

The versioned API is rooted at `/api/v1`:

- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET|PUT|DELETE /auth/me`
- `GET /auth/sessions`, `POST /auth/sessions/logout-others`
- `POST /auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification`
- `GET|POST /profiles`, `GET|PUT|DELETE /profiles/:id`
- `GET|POST /interviews`, `GET|PUT|DELETE /interviews/:id`, `POST /interviews/:id/complete`
- `GET|POST /interviews/:id/turns`
- `GET /usage`
- `GET /export`
- `POST /ai/responses` (SSE streaming), `/ai/realtime-secret`, `/ai/summary`

All product and AI endpoints determine the user from the validated bearer session. Client-supplied user IDs are never trusted. Ownership misses return `404`, preventing cross-user discovery.

## Security and privacy notes

- Passwords are hashed with bcrypt; passwords, tokens, prompts, resumes, job descriptions, questions, and answers are not intentionally logged.
- Raw session tokens are stored only in encrypted local Electron storage; the database stores SHA-256 token hashes.
- The provider key exists only in backend configuration. Realtime audio uses short-lived provider client secrets minted by the authenticated backend.
- Completed meaningful Q&A turns are persisted. Partial transcripts, VAD events, detector state, and individual streamed tokens are not.
- AI and authentication endpoints are rate-limited, daily token/request limits and per-user concurrency are server-enforced, and request bodies have explicit size/shape limits.
- Production requires a verified TLS PostgreSQL connection unless the API uses Render's explicitly configured private-network database endpoint. Deploy the API behind HTTPS; deployment is intentionally outside this phase.

Private-beta production configuration, Docker usage, migration policy, email setup, invites, backup/restore, and operational prerequisites are documented in [docs/production.md](docs/production.md).

## Existing assistant behavior

- MIC, SYSTEM, and MIC + SYSTEM live modes
- source-aware Auto Assist and manual Generate Answer
- Current/Previous/Pin/History answer UX
- session/workspace memory
- multiple screenshot and file attachments
- transparent always-on-top overlay and bubble mode
- `Ctrl+Alt+S` region capture and `Ctrl+Alt+B` hide/show

The stable audio, VAD, question detection, capture, and answer-display pipelines remain in place. Only their account/data/AI boundaries now use the backend.

## Release status

The repository is being hardened for a small controlled private beta. It is not public-production ready: deployment infrastructure, managed secret rotation, provider-specific email integration validation, monitoring/alerting, managed backup restore testing, privacy/legal review, and third-party security review remain operational prerequisites.
