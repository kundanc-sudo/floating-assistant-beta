# Render Free technical-test deployment

Status: **locally prepared; external deployment is blocked and has not been performed**.

This runbook creates exactly one Free Render web service and one Free Render Postgres database for synthetic technical testing. It is not a production or real-user environment.

## Mandatory gates

Do not create or sync the Blueprint until all of these are true:

1. Use only the newly rotated restricted AI test key; never restore the previously exposed key.
2. Use Render's generated PostgreSQL credential; never reuse the previously exposed local password.
3. Verify a sender/domain in Resend and create a test-only sending credential.
4. Use only approved test inboxes and synthetic profiles, resumes, interviews, questions, and answers.
5. Confirm the Render service and database both show the **Free** plan before approving creation. Do not add a payment method for this test if a hard $0 boundary is required.

Never paste a secret into chat, source control, `render.yaml`, a screenshot, or shared logs. The Blueprint uses `sync: false` for secret values.

## What the prepared Blueprint does

[`render.yaml`](../render.yaml) declares:

- one Docker web service, `floating-assistant-api-test`, on `plan: free`;
- one PostgreSQL database, `floating-assistant-test-db`, on `plan: free`;
- `server/Dockerfile` with `server` as the build context;
- `/health/ready` as the Render health check;
- automatic deploys disabled;
- the database's private connection string injected as `DATABASE_URL`;
- an explicit Render private-network database mode and a five-connection application pool;
- production, proxy, beta, authentication, and conservative test usage settings;
- prompts for the new AI key and Resend key/sender instead of storing them in Git.

The service reads Render's platform-provided `PORT` and binds to `0.0.0.0`. It derives `PUBLIC_BASE_URL`, the share viewer URL, and the default share origin from Render's platform-provided `RENDER_EXTERNAL_HOSTNAME`; no guessed subdomain is committed.

Do not add `preDeployCommand`: Render's pre-deploy command is unavailable to a Free web service. Do not change the Docker start command to run migrations on every cold start.

## Current Free-tier limitations

- A Free web service sleeps after 15 minutes without an HTTP request or inbound WebSocket message. A wake-up generally takes about one minute.
- A workspace receives 750 Free instance hours per month. Exhaustion suspends Free web services until the next month.
- Free services have an ephemeral filesystem, one instance, no persistent disk, no shell/SSH, and no one-off jobs.
- Outbound bandwidth and build minutes count against workspace allowances. With no payment method, exhaustion suspends services or disables builds instead of billing; with a payment method, overage can be billed subject to account settings/spend limits.
- Render may suspend a Free service for unusually high service-initiated public traffic, which matters because the backend calls an external AI API.
- A workspace can have only one active Free Render Postgres database. It has 1 GB fixed storage, no backups, no point-in-time recovery, and no managed connection pooling.
- A Free database expires 30 days after creation, becomes inaccessible, and is deleted after the documented 14-day grace period unless upgraded. Render currently documents a maximum of 50 direct connections for this plan; the application is deliberately limited to five.
- Render can restart or maintain Free resources at any time.
- Outbound SMTP ports 25, 465, and 587 are blocked; the Resend integration uses its official HTTPS Email API instead.

These limits make the environment unsuitable for real beta users or personal data.

## Create the Render account and connect GitHub

Perform these steps only after a separate explicit deployment authorization:

1. Sign in to Render and keep the workspace on Hobby/Free.
2. Open **Account Settings > Git Providers** (or select GitHub during creation), authorize only the repository containing this project, and use least-privilege repository access.
3. In the Render Dashboard, select **New > Blueprint** and select that repository and branch.
4. Render should detect the repository-root `render.yaml`. Review the plan before applying it.
5. Confirm the preview contains exactly one **Free** web service and one **Free** PostgreSQL database. Cancel if any item is paid, duplicated, or requests an upgrade.
6. Keep both resources in the same Render region. The Blueprint omits `region`, so both use Render's same default region when newly created.
7. Supply only newly rotated test secrets in Render's secret prompts:
   - `AI_PROVIDER_KEY`
   - `EMAIL_PROVIDER_KEY`
   - `EMAIL_FROM`
8. Do not sync/apply until the Resend sender/domain is verified and all newly rotated secrets are ready to enter privately.

The Blueprint automatically supplies `DATABASE_URL`; do not copy a database password into it. Render supplies `PORT` and `RENDER_EXTERNAL_HOSTNAME` automatically.

## Environment checklist

Set by the Blueprint:

| Variable | Test value/source |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Render database `connectionString` reference |
| `DATABASE_SSL_MODE` | `render-internal` |
| `DATABASE_POOL_MAX` | `5` |
| `DATABASE_CONNECTION_TIMEOUT_MS` | `10000` |
| `DATABASE_IDLE_TIMEOUT_MS` | `30000` |
| `TRUST_PROXY` | `true` |
| `EMAIL_PROVIDER` | `resend` |
| `BETA_MODE` | `true` |
| `AUTH_SESSION_TTL_HOURS` | `168` |
| `AUTH_MAX_SESSIONS_PER_USER` | `10` |
| `PASSWORD_RESET_TTL_MINUTES` | `30` |
| `EMAIL_VERIFICATION_TTL_HOURS` | `24` |
| `BETA_DAILY_AI_REQUESTS` | `25` |
| `BETA_DAILY_TOKENS` | `50000` |
| `BETA_CONCURRENT_AI_REQUESTS` | `1` |
| `AI_TIMEOUT_MS` | `120000` |
| `SHARE_SESSION_TTL_MINUTES` | `60` |

Secret prompts that must be completed by the operator:

| Variable | Requirement |
|---|---|
| `AI_PROVIDER_KEY` | newly rotated restricted test key |
| `EMAIL_PROVIDER_KEY` | newly generated test-only Resend API key |
| `EMAIL_FROM` | verified test sender |

Platform values used automatically:

| Variable | Purpose |
|---|---|
| `PORT` | Render-selected listening port |
| `RENDER_EXTERNAL_HOSTNAME` | derives the public HTTPS base URL |

Optional overrides are `PUBLIC_BASE_URL`, `ALLOWED_ORIGINS`, `SHARE_ALLOWED_ORIGINS`, `VIEWER_BASE_URL`, the `AI_*_MODEL` values, and other defaults in `server/.env.example`. If browser API clients are later added, set `ALLOWED_ORIGINS` to explicit HTTPS origins; never use `*`. Electron main-process requests do not normally send an Origin header.

## Apply existing migrations safely

The Free service has no shell, one-off jobs, or paid pre-deploy command. Run the already-built Drizzle migration runner once from a trusted local checkout, using Render's **external** database URL. Do not use schema push and do not generate another migration.

1. In Render Postgres, open **Connect**, copy the external URL, and ensure your current public IP is permitted by its external access controls.
2. Confirm the created database reports PostgreSQL 14 or newer before applying migrations. The Blueprint intentionally accepts Render's current default major version instead of pinning a version that might become unavailable.
3. From `D:\project`, use this PowerShell sequence. The secure prompt keeps the URL out of shell history and clears its unmanaged memory and environment variable afterward:

```powershell
$renderDbSecret = Read-Host 'Paste Render External Database URL' -AsSecureString
$renderDbPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($renderDbSecret)
try {
  $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($renderDbPointer)
  $env:DATABASE_SSL_MODE = 'verify-full'
  npm.cmd --prefix server run db:migrate:runtime
  npm.cmd --prefix server run db:verify
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:DATABASE_SSL_MODE -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($renderDbPointer)
  $renderDbSecret = $null
}
```

4. A failure is a stop condition. Do not start beta testing until both commands succeed.
5. Revoke external database access again if it was temporarily widened.

This runs `server/drizzle/0000_open_wallflower.sql` and subsequent reviewed migrations through Drizzle's migration history. The external Render endpoint uses TLS with CA and hostname verification. It does not print `DATABASE_URL`.

## Verify the deployed service

After migration and a successful deployment, copy the exact HTTPS URL shown by Render; do not infer it from the service name.

```powershell
$renderApi = Read-Host 'Exact Render HTTPS service URL'
Invoke-RestMethod "$renderApi/health/live"
Invoke-RestMethod "$renderApi/health/ready"
```

`/health/live` checks the process. `/health/ready` also checks PostgreSQL. A waking Free service can take about one minute; retry these idempotent health requests manually. Do not create keep-alive traffic.

Inspect **Logs** in the Render service for startup, health, sanitized request/error, and graceful-shutdown events. Never paste tokenized verification/reset URLs or secrets into support logs. Free log retention is limited; export only sanitized evidence if needed.

## Configure Electron for the remote test

Keep local development unchanged:

```text
API_BASE_URL=http://localhost:3001
SHARE_SERVER_URL=http://localhost:3001
```

For the packaged technical-test build, set both variables to the exact Render HTTPS URL before packaging/launching:

```text
API_BASE_URL=https://<exact-host-shown-by-render>
SHARE_SERVER_URL=https://<exact-host-shown-by-render>
```

Do not commit that generated environment file. Packaged builds reject a non-HTTPS API URL and do not silently fall back to localhost when an explicit remote URL is supplied.

The client reports unavailable/interrupted backend connections without deleting its encrypted session, current answer, previous answers, pinned answers, history, or interview context. Retry a health/login request after wake-up. Do not automatically repeat an AI generation because the first request might have reached the server and incurred provider usage.

## SSE test

The current API returns `Content-Type: text/event-stream; charset=utf-8`, emits `data:` frames incrementally, disables caching, propagates client abort/connection close to the upstream AI request, releases concurrency in `finally`, and enforces `AI_TIMEOUT_MS`. No code rewrite was necessary.

Render supports ordinary streaming HTTP, but actual proxy buffering and first-token timing remain unverified until deployment. With a synthetic verified test account:

1. Start one synthetic interview.
2. Submit one non-sensitive prompt from Electron.
3. Observe multiple answer deltas before completion; do not log their text.
4. Record dispatch-to-first-delta and dispatch-to-completion timing.
5. Cancel one request and confirm upstream work and concurrency are released.
6. Confirm one usage record and one completed turn; do not automatically replay an interrupted request.

## WebSocket test

The backend handles `/ws` upgrades on the same HTTP server, validates the share join token, limits joins, rejects invalid/expired tokens, and removes closed clients through the existing share manager. Render supports inbound WebSockets.

1. Create a synthetic share session through the existing desktop flow.
2. Open its exact Render viewer URL and confirm the WebSocket upgrades to `wss://`.
3. Publish synthetic response events and confirm incremental delivery.
4. Stop the share and confirm disconnect cleanup.
5. Leave a valid connection idle long enough only if testing sleep behavior: inbound WebSocket messages count as activity, but do not send artificial keep-alives to defeat Free limits.

## Authentication and two-user isolation

Email verification remains mandatory. `example.test` addresses are placeholders and cannot receive mail; use two operator-approved deliverable test inboxes.

For User A and User B, test register, delivered verification link, login, `/api/v1/auth/me`, logout, session persistence, profile create/read, interview create/read, completed turns, history, export, and account deletion. Then use A's token against every B profile/interview/turn/export identifier and attempt an AI request with B's interview ID. Each must fail without revealing whether unrelated data exists. Use only synthetic content and delete both accounts afterward.

## Cold starts and failures

- Treat connection timeout/unavailable during wake-up as retryable for health, authentication reads, and other idempotent requests.
- Show the existing connection error/status and allow the user to retry after roughly one minute.
- Preserve all local answer/history/context state.
- Never auto-retry answer generation, account creation, destructive operations, or other non-idempotent requests.
- Expect occasional database maintenance and service restarts on Free resources.

## Deletion and $0 controls

1. Before creation, verify both planned resources say **Free** and there are no additional services, disks, cron jobs, private services, or paid jobs.
2. Keep auto-deploy disabled to control build-minute use.
3. Keep one service, one database, one instance, low AI limits, and synthetic traffic only.
4. Review Render **Billing > Monthly Included Usage** during testing. With no payment method, excess usage should suspend/disable Free resources rather than bill; still review the current account and spend-limit settings.
5. At test completion, export no personal data. Delete the web service, then delete the Free database from each resource's **Settings > Delete** control and confirm both disappear from the workspace.
6. Revoke the test AI key and Resend key, remove the GitHub integration if it is no longer needed, and remove the remote URLs from test packaging configuration.

## Before real beta users

Move off the disposable Free database to managed PostgreSQL with backups and tested restore/PITR; select paid capacity with predictable availability, shell/release migration support, monitoring/alerts, sufficient connections and retention; complete email deliverability and abuse controls; perform external security/privacy review; publish retention/deletion policies; validate actual SSE/WebSocket behavior under load; and repeat the full two-user, failure, restore, desktop, MIC/SYSTEM, and interview regression checklists.

## Stop point

No Render resource, cloud database, cloud account, deployment, cloud migration, or secret upload is part of local preparation. The next action is for the owner to verify the Resend sender/domain and configure the new Resend key privately, then explicitly authorize external deployment in a new instruction.
