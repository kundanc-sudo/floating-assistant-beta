# Manual Render deployment

This runbook deploys the existing backend and website through the Render dashboard. It uses the PostgreSQL instance that already exists; it does not create another database. Treat every database URL and provider credential as a secret and enter it only through Render's environment controls or a temporary local environment variable.

## 1. Backend Web Service

Create a **Web Service** from the repository and configure it as follows:

- Runtime: **Docker**
- Repository root directory: leave blank (the repository root)
- Dockerfile path: `./server/Dockerfile`
- Docker build context: `./server`
- Health check path: `/health/ready`
- Start command: leave blank; the image starts with `node dist/server.js`

The service must use HTTPS. Set `TRUST_PROXY=true` because Render terminates HTTPS at its proxy. Set `PUBLIC_BASE_URL` to the exact HTTPS API origin displayed by Render, `WEB_APP_URL` to the exact HTTPS website origin, and `ALLOWED_ORIGINS` to the website origin. Do not use wildcards. Origin values are origins only (scheme plus host, without paths).

Required production variables:

```text
NODE_ENV
DATABASE_URL
DATABASE_SSL_MODE
AI_PROVIDER_KEY
PUBLIC_BASE_URL
WEB_APP_URL
TRUST_PROXY
ALLOWED_ORIGINS
EMAIL_PROVIDER
EMAIL_PROVIDER_KEY
EMAIL_FROM
```

For the Render Web Service, set `DATABASE_URL` from the existing database's **internal** connection URL and set `DATABASE_SSL_MODE=render-internal`. Keep the Web Service and database in the same Render region. Render supplies `PORT` and `RENDER_EXTERNAL_HOSTNAME`; do not replace `PORT` with a fixed value.

Review and set the applicable operational variables from `server/.env.example`, including the database-pool/time-out settings, AI model/time-out settings, authentication lifetimes, document limits, beta limits, and share settings. If browser sharing is enabled, set `SHARE_ALLOWED_ORIGINS` to explicit trusted HTTPS origins and `VIEWER_BASE_URL` to its exact HTTPS public origin. `EMAIL_PROVIDER_URL` is only used by the generic webhook email provider; Resend uses its fixed official API endpoint.

Never place `DATABASE_URL`, `AI_PROVIDER_KEY`, `EMAIL_PROVIDER_KEY`, or any other secret in source control, Docker build arguments, or a `VITE_` variable.

## 2. Website Static Site

Create a **Static Site** from the same repository:

- Root directory: `web`
- Build command: `npm ci && npm run build`
- Publish directory: `dist`
- Environment variable: `VITE_API_BASE_URL` set to the exact HTTPS backend origin

Add the SPA rewrite rule:

```text
Source:      /*
Destination: /index.html
Action:      Rewrite
```

The website uses `BrowserRouter`, so the rewrite is required for direct navigation and refreshes on routes such as `/login`, `/settings`, and `/interviews/:id`.

After Render assigns the website URL, configure the backend's `WEB_APP_URL` and `ALLOWED_ORIGINS` with that exact HTTPS origin. Restart/redeploy the backend after changing its environment. This is required for browser cookies, CORS, trusted-origin checks, CSRF protection, and email links. Do not add a trailing path and do not use `*`.

## 3. Safely migrate the existing database

Do not assume the new database is migrated. The backend verifies its schema during startup and will remain unready until every reviewed migration has been applied, including the migration that creates `companion_pairings`.

Render Free does not provide a pre-deploy command or shell suitable for this workflow. Run the repository's existing migration runner once from a trusted checkout using the database's **external** URL. The application itself should continue using the internal URL described above.

Before changing anything, compare the database name and role reported by PostgreSQL with the existing database details shown in the Render dashboard. The following PowerShell commands keep the URL out of command history, use verified TLS, and clear it afterward:

```powershell
Set-Location D:\project
npm.cmd --prefix server ci
npm.cmd --prefix server run build

$renderDbSecret = Read-Host 'Paste the existing Render External Database URL' -AsSecureString
$renderDbPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($renderDbSecret)
try {
  $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($renderDbPointer)
  $env:DATABASE_SSL_MODE = 'verify-full'

  node --input-type=module -e "import pg from './server/node_modules/pg/lib/index.js'; import { databaseConnectionString } from './server/dist/db/databaseConnection.js'; const client = new pg.Client({ connectionString: databaseConnectionString(process.env.DATABASE_URL, 'verify-full') }); await client.connect(); const result = await client.query('select current_database() as database, current_user as role, version()'); console.log(result.rows[0]); await client.end();"

  node server/dist/cli/verifyDatabase.js
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:DATABASE_SSL_MODE -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($renderDbPointer)
  $renderDbSecret = $null
}
```

On a new empty database, the verification command is expected to report missing tables. Stop if the database name or role does not match the intended Render database, if TLS verification fails, or if the database is not empty when it should be.

Only after confirming the target, apply the existing reviewed migrations and verify the completed schema:

```powershell
Set-Location D:\project

$renderDbSecret = Read-Host 'Paste the same Render External Database URL' -AsSecureString
$renderDbPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($renderDbSecret)
try {
  $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($renderDbPointer)
  $env:DATABASE_SSL_MODE = 'verify-full'

  node server/dist/cli/migrateDatabase.js
  node server/dist/cli/verifyDatabase.js
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:DATABASE_SSL_MODE -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($renderDbPointer)
  $renderDbSecret = $null
}
```

Do not use schema push and do not generate a new migration during deployment. The final verification must list `companion_pairings` with the other expected tables. A migration or verification failure is a stop condition; do not repeatedly rerun commands without understanding the error.

After migration, deploy/restart the backend and confirm both health endpoints using the exact backend URL shown by Render:

```powershell
$renderApi = Read-Host 'Exact Render HTTPS backend origin'
Invoke-RestMethod "$renderApi/health/live"
Invoke-RestMethod "$renderApi/health/ready"
```

Do not paste database credentials, provider keys, session tokens, or tokenized email links into logs, tickets, or source files.
