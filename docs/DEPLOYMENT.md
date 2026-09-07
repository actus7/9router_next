# Deploying ModelHub

## The constraint that decides everything

ModelHub keeps its state in an embedded SQLite file at `DATA_DIR/db/data.sqlite`,
and `src/lib/db/driver.ts` reaches it through a **synchronous** adapter
(`get`/`all`/`run`/`exec`/`transaction` all return without awaiting). Swapping in
a network database is therefore not a configuration change — every repository in
`src/lib/db/repos` and every caller would have to become async.

So the hosting requirement is simply: **a writable disk that survives a restart.**

## Host suitability

| Host | Boots | Keeps data | Verdict |
|---|---|---|---|
| Local machine, `npm start` | yes | yes | Supported — the primary target |
| Docker with a volume | yes | yes | Supported — see below |
| Fly.io / Railway / Render with a persistent volume | yes | yes | Supported |
| VPS with systemd | yes | yes | Supported |
| Vercel, Netlify, Cloudflare Workers | yes | **no** | Demo only |

### Why serverless hosts are demo-only

They have no writable persistent filesystem. `os.homedir()` on Vercel reports a
path that does not exist and cannot be created, so `src/lib/dataDir.ts` falls
back to the OS temp directory. The app boots and every route works, but the
database, the JWT secret and the backups are erased when the instance recycles —
which is constantly.

This is visible rather than silent:

- a `[DATA_DIR] … is not writable → using '/tmp/modelhub'` warning at boot,
- `storageEphemeral: true` in `GET /api/settings`,
- a permanent banner across the top of the dashboard.

Setting `JWT_SECRET` on such a host is worth doing anyway — it at least keeps
logins from breaking on every cold start — but it does not make provider
credentials or usage history survive.

## Docker (recommended for self-hosting)

```bash
docker compose up -d --build
```

Then open `http://localhost:20128`.

The `modelhub-data` volume is the deployment. Back it up, and it is the only
thing that has to move when the host does. Without the volume the container is
no better than the serverless case.

To run the image directly:

```bash
docker build -t modelhub .
docker run -d --name modelhub -p 20128:20128 -v modelhub-data:/data modelhub
```

## Environment

| Variable | Default | Effect |
|---|---|---|
| `DATA_DIR` | OS home dir, then OS temp dir | Where the database, backups and JWT secret live |
| `JWT_SECRET` | generated and written to `DATA_DIR/jwt-secret` | Stable dashboard sessions. Required when `DATA_DIR` is not persistent, or across replicas |
| `CREDENTIAL_KEY` | unset | Encrypts provider credentials at rest (AES-256-GCM). Unset means clear text, warned at boot |
| `CREDENTIAL_ENCRYPTION_REQUIRED` | `false` | Refuse to boot without `CREDENTIAL_KEY`. Off by default so upgrades do not brick installs that never opted in |
| `PORT` | `20128` | Listen port in the container |

Rotation procedures for `CREDENTIAL_KEY` are in [OPERATIONS.md](OPERATIONS.md).

## Upgrading

Schema changes back the database up before applying versioned migrations, so a
normal restart on a new image is the upgrade path. Never delete or rewrite the
database as a deployment shortcut — see [OPERATIONS.md](OPERATIONS.md).
