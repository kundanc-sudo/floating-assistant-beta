# Backend production and private-beta operations

The Electron desktop application is not containerized. Deploy only the backend behind an HTTPS-terminating reverse proxy or managed platform.

## Required production configuration

Start from `server/.env.example` and provide values through the hosting platform's secret manager. Production startup rejects a missing provider key, a database connection without TLS (`DATABASE_SSL_MODE=verify-full` is preferred for public endpoints), non-HTTPS public URL, untrusted proxy configuration, console email provider, incomplete email-provider credentials, or wildcard origin. `DATABASE_SSL_MODE=render-internal` is accepted only inside Render for its injected private-network `connectionString`, where Render requires TLS to be omitted; it must not be used with a public database endpoint.

`ALLOWED_ORIGINS` is a comma-separated allow-list for browser-origin API calls. Electron main-process requests normally have no `Origin` header and remain supported. Do not expose provider, database, email, or session credentials to Vite/renderer variables.

## Build and start

```powershell
npm.cmd install --prefix server
npm.cmd --prefix server run build
npm.cmd --prefix server run smoke:built
npm.cmd --prefix server run start
```

The deployment platform should route HTTPS traffic to port 3001. Check `/health/live` for process liveness and `/health/ready` for database readiness. Readiness intentionally returns no dependency details.

The optional image is built from the repository root with:

```powershell
docker build -f server/Dockerfile server
```

It runs as the non-root `node` user with production dependencies only. Schema migrations are a separate, explicit deployment step and are not run by container startup.

The production image supports a release-phase migration without the development-only `drizzle-kit` package:

```text
node dist/cli/migrateDatabase.js
```

See [private-beta-deployment.md](private-beta-deployment.md) for the provider-selection gate and Phase 3B requirements.
The temporary Render Free test procedure is documented in [render-free-deployment.md](render-free-deployment.md).

## Migrations

Generate a migration only after intentionally changing `server/src/db/schema.ts`:

```powershell
npm.cmd --prefix server run db:generate
```

Review the generated SQL and snapshot. Back up production, then apply migrations as a one-off release job before switching application traffic:

```powershell
npm.cmd --prefix server run db:migrate
```

Before a release, a PostgreSQL role with temporary database creation permission can validate the full migration chain in a disposable database. The command creates a uniquely named database, verifies all application tables, and drops only that database:

```powershell
npm.cmd --prefix server run db:verify-fresh
```

If migration fails, stop the release and investigate. The application verifies required tables but never mutates production schema during normal startup.

## Private-beta invites

Set `BETA_MODE=true`. Create a single-use, expiring invite on a trusted backend host:

```powershell
npm.cmd --prefix server run beta:create-invite -- --email person@example.com --hours 72
```

Omit `--email` for an invite that is not email-bound. The raw code is printed once; PostgreSQL stores only its SHA-256 hash.

## Email

The Render test deployment uses Resend's official HTTPS Email API:

```text
EMAIL_PROVIDER=resend
EMAIL_PROVIDER_KEY=<Resend secret configured in the server secret manager>
EMAIL_FROM=Floating Assistant <sender@verified-domain.example>
```

Resend uses the fixed `https://api.resend.com/emails` endpoint, so `EMAIL_PROVIDER_URL` is not needed. The backend sends `{ from, to, subject, text }` with `Authorization: Bearer <key>`, a 15-second timeout, and sanitized failures. Neither provider response bodies nor credentials are logged.

The generic webhook provider remains available with `EMAIL_PROVIDER=webhook` and additionally requires an HTTPS `EMAIL_PROVIDER_URL`. Development may continue using `EMAIL_PROVIDER=console`, but verification and reset tokens are deliberately omitted from console logs. Automated auth tests continue to use the in-memory test email service.

Unverified users may sign in, manage their account, and prepare interviews, but AI responses, realtime credentials, and AI summaries require verified email.

## Backup and restore

For managed PostgreSQL, enable automatic backups, choose a documented retention period, enable point-in-time recovery where available, and test a restore into an isolated database before beta launch and periodically thereafter.

Development backup (PowerShell; enter credentials through PostgreSQL-supported secure mechanisms rather than the command line):

```powershell
pg_dump --format=custom --no-owner --file=floating-assistant.dump --dbname="$env:DATABASE_URL"
createdb floating_assistant_restore_test
pg_restore --no-owner --dbname=floating_assistant_restore_test floating-assistant.dump
```

Verify table counts and a disposable login in the restored database, then remove only the explicitly named restore-test database. Never overwrite the active database while testing restoration.

## Data and deletion policy

Account deletion requires the current password and literal `DELETE`. PostgreSQL cascades removal of sessions, auth tokens, profiles, interviews, turns, and usage events. Usage records are deleted rather than retained, favoring privacy over historical analytics. Logout only revokes a session and never deletes product data.

JSON export contains profile metadata, interview metadata, and completed question/answer history. It excludes password hashes, token hashes, usage/security records, resume text, job descriptions, and instructions.

## Operational prerequisites

- Rotate all credentials that have ever appeared in source, screenshots, chat, or shared logs.
- Use a managed PostgreSQL service with TLS and tested backups.
- Configure an HTTPS domain, proxy forwarding, origin allow-list, and Resend sender/domain.
- Apply and verify migrations before starting the new release.
- Centralize structured stdout logs with access control and retention.
- Monitor readiness, 5xx rate, AI timeouts, rate limits, pool saturation, and email failures.
- Complete an external security/privacy review before public production.
