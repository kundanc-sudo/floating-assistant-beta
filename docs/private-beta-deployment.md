# Phase 3B private-beta deployment gate

This document is provider-neutral. No infrastructure should be created until the owner selects a hosting environment, PostgreSQL provider, domain, email provider, and logging/monitoring destination.

## Minimum infrastructure requirements

- **Runtime:** Linux container capable of running Node.js 24 (the application supports Node.js 20+, while the supplied image pins Node 24 Alpine).
- **Container:** one stateless backend instance initially; writable persistent filesystem storage is not required.
- **PostgreSQL:** PostgreSQL 14+, TLS with `sslmode=require` or stronger, automatic backups, a tested restore path, and at least 12 available connections. The application pool defaults to 10 connections.
- **Networking:** outbound HTTPS/WSS access to the AI provider and outbound HTTPS access to the selected email API; inbound HTTPS with WebSocket upgrade support for `/ws`.
- **Streaming:** unbuffered `text/event-stream` responses, no proxy response buffering, a request timeout greater than `AI_TIMEOUT_MS` plus platform overhead, and prompt propagation of client disconnects.
- **TLS:** platform-managed valid public certificate and HTTPS endpoint. Packaged Electron builds reject an HTTP API URL.
- **Health checks:** `/health/live` for liveness and `/health/ready` for readiness. Readiness requires PostgreSQL.
- **Secrets:** managed secret injection for `DATABASE_URL`, `AI_PROVIDER_KEY`, `EMAIL_PROVIDER_KEY`, and platform credentials. Never bake `.env` into the image.
- **Logs:** searchable structured stdout/stderr with retention and access controls. Query strings must not be collected because verification/reset links contain one-time credentials.
- **Resources:** begin with at least one shared vCPU and 512 MiB memory for 3–5 testers, then measure. Configure restart-on-failure and resource alerts.

## Required production variables

Use the names and descriptions in `server/.env.example`. At minimum, production requires:

```text
NODE_ENV=production
PORT=<platform port>
DATABASE_URL=<managed PostgreSQL TLS URL>
AI_PROVIDER_KEY=<managed secret>
PUBLIC_BASE_URL=https://<selected API domain>
TRUST_PROXY=true
ALLOWED_ORIGINS=<explicit browser origins, no wildcard>
EMAIL_PROVIDER=resend
EMAIL_PROVIDER_KEY=<managed secret>
EMAIL_FROM=<verified sender>
BETA_MODE=true
```

Also set intended authentication TTLs, pool sizes, AI models/timeouts, usage limits, and sharing origins from `server/.env.example`. Electron main-process requests do not normally send an `Origin`; browser origins remain allow-listed.

## Container release workflow

```powershell
docker version
docker build -f server/Dockerfile server -t floating-assistant-server:phase3b
```

The final image contains compiled backend code, production dependencies, and reviewed Drizzle SQL migrations. It does not copy `.env`, tests, TypeScript sources, or development dependencies.

Run the release migration once before switching traffic:

```text
node dist/cli/migrateDatabase.js
```

Normal application startup remains:

```text
node dist/server.js
```

Migration failure must fail the release; application startup never performs an implicit schema mutation.

## Compatible deployment patterns

Select one pattern before generating provider-specific manifests:

1. A managed container platform with managed PostgreSQL, custom-domain TLS, stdout log search, health checks, WebSocket support, and configurable request timeouts.
2. A managed application platform that builds the supplied Dockerfile and offers an explicit pre-deploy/release command for migrations.
3. A cloud container service plus managed PostgreSQL, managed certificate/load balancer, centralized logs, and monitoring. This provides more control but requires more operational setup.

Candidate services include Render, Railway, Fly.io, Azure Container Apps, Google Cloud Run, or AWS ECS/App Runner, provided the selected plan satisfies SSE timeout and managed PostgreSQL requirements. This is compatibility guidance, not a provider selection.

## Inputs required to continue Phase 3B

Provide all of the following:

1. Selected backend hosting provider and account/project access method.
2. Selected managed PostgreSQL provider/instance and confirmation that TLS, backups, retention, and restore testing are available.
3. API domain or subdomain and DNS-control method.
4. Selected production email provider plus one real beta recipient address.
5. Selected centralized logging/monitoring destination and alert-recipient channel.
6. Confirmation that the AI key and PostgreSQL password were newly rotated after the prior exposure.
7. Intended beta request/token/concurrency limits.
8. Two real beta email addresses for the mandatory isolation test.
9. Whether a packaged Electron installer is already available or a portable production build should be used for manual rehearsal.

Do not paste credentials into chat or commit them. Add them directly through the selected platform's secret manager.

## Validation evidence to collect after selection

- Image digest and static image secret inspection
- Migration and table/index verification
- Provider backup configuration and an actual disposable restore result
- Public certificate and HTTPS health results
- Incremental SSE timing for at least ten requests
- Real verification and password-reset email delivery
- Invite rejection/reuse/expiration/email-bound behavior
- Two-user API and desktop isolation
- Platform log privacy queries
- Monitoring and alert delivery test
- Usage/session/export/delete/failure rehearsals
- Human MIC/SYSTEM interview checklist results

Until those tests are performed against selected real infrastructure, Phase 3B remains **NO-GO**.
