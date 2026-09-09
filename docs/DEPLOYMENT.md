# Deploying ModelHub

## The constraint that decides everything

ModelHub keeps its state in **Neon Postgres**, reached through
`src/lib/db/adapters/postgresAdapter.ts`, and its identity in **Neon Auth**.
Nothing that matters is on the container's disk any more: the provider
credentials, the gateway API keys, the usage history, the settings and the
sessions are all rows behind an account.

So the hosting requirement is no longer "a writable disk". It is three
environment variables:

| Variable | Required | What breaks without it |
|---|---|---|
| `DATABASE_URL` | yes | Every route that touches data. The pooled endpoint (host contains `-pooler`) — the app opens interactive transactions, which the HTTP endpoint does not support |
| `NEON_AUTH_BASE_URL` | yes | Sign-in. There is no operator password and no anonymous mode: a request with no account owns nothing |
| `NEON_AUTH_COOKIE_SECRET` | yes | Session verification. At least 32 characters; changing it signs everybody out |

`.env.example` is the full list, including the optional ones.

## Host suitability

| Host | Verdict |
|---|---|
| Vercel | Supported. `vercel.json` sets `maxDuration: 300` for `src/app/api/**` — long completions need it, and Vercel's own default is 300s |
| Docker with a volume | Supported — see below |
| Fly.io / Railway / Render / a VPS | Supported |
| Local machine, `npm start` | Supported |

### What DATA_DIR still does

`DATA_DIR` holds only host-local, file-backed state: the Cloudflare/Tailscale
tunnel and its binaries, pxpipe's install, headroom's process files and the
machine id. On a host with no writable home directory the app falls back to the
OS temp dir, warns at boot, reports `storageEphemeral: true` from
`GET /api/settings` and shows a banner — all of which now mean *those features
reset on restart*, not *your data is gone*. On a serverless host they are not
usable anyway.

## Vercel

Set the three required variables (plus `CREDENTIAL_KEY`, see below) in the
project's environment, and deploy. `next.config.ts` drops `output: "standalone"`
when `VERCEL` is present, because Vercel's adapter consumes Next's normal
tracing manifests instead.

`npm run build` runs `scripts/check-static-api-routes.mjs` after `next build`,
so a route handler that lost its `assertRequestRuntime()` and got prerendered
fails the deploy rather than serving a frozen build-time body forever.

## Docker (self-hosting)

```bash
cp .env.example .env      # fill in DATABASE_URL and the two Neon Auth values
docker compose up -d --build
```

Then open `http://localhost:20128`.

`docker-compose.yml` fails fast when a required variable is missing rather than
starting a container that answers `/api/health` and 500s on everything else. The
`modelhub-data` volume is still worth keeping — it holds the host-local state
listed above — but it is no longer where the data lives.

To run the image directly:

```bash
docker run -d --name modelhub -p 20128:20128 \
  -e DATABASE_URL=... -e NEON_AUTH_BASE_URL=... -e NEON_AUTH_COOKIE_SECRET=... \
  -v modelhub-data:/data modelhub
```

## Environment

| Variable | Default | Effect |
|---|---|---|
| `DATABASE_URL` | — | **Required.** Pooled Neon connection string |
| `NEON_AUTH_BASE_URL` | — | **Required.** Neon Auth endpoint |
| `NEON_AUTH_COOKIE_SECRET` | — | **Required.** Signs the session cookie |
| `CREDENTIAL_KEY` | unset | Encrypts provider credentials at rest (AES-256-GCM). Unset means clear text in the database, warned at boot |
| `CREDENTIAL_ENCRYPTION_REQUIRED` | `false` | Refuse to boot without `CREDENTIAL_KEY`. Off by default so upgrades do not brick installs that never opted in |
| `DASHBOARD_ALLOWED_HOSTS` | empty (any) | Comma-separated hosts allowed to serve the dashboard |
| `ALLOW_PRIVATE_PROVIDER_ENDPOINTS` | `false` | Lets an account point a provider at a private/loopback address. Needed for self-hosted Ollama; leave off on any deployment where people can sign up, where it is an SSRF primitive |
| `RATE_LIMIT_GATEWAY_PER_MINUTE` | `600` | Per-account ceiling on gateway requests, counted per process. `0` disables |
| `RATE_LIMIT_DASHBOARD_PER_MINUTE` | `1200` | Same, for dashboard API routes |
| `DATA_DIR` | OS home dir, then OS temp dir | Host-local features only — tunnel, pxpipe, headroom, machine id |
| `PORT` | `20128` | Listen port in the container |

Set `CREDENTIAL_KEY` before storing any provider credential. Rotation is in
[OPERATIONS.md](OPERATIONS.md); losing the key makes existing encrypted
credentials unrecoverable.

## Upgrading

The schema is declarative and synced additively on boot: `syncSchema()` creates
missing tables, adds missing columns and creates missing indexes. There is no
versioned migration chain — Neon's branching covers the rollback case. A
destructive change (drop, rename, retype) is run by hand against the branch and
then reflected in `src/lib/db/schema.ts`.

Concurrent cold starts after a deploy all run `syncSchema()` at once; the DDL is
written to tolerate losing that race rather than failing the instance.
