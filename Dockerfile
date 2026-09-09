# Self-hosted runtime for ModelHub.
#
# The state is NOT in this image. Since the Neon migration the database, the
# provider credentials, the API keys and the usage history live in Neon
# Postgres, and sign-in is Neon Auth — so the container needs DATABASE_URL,
# NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET to do anything at all. See
# docs/DEPLOYMENT.md.
#
# The volume is still worth mounting: DATA_DIR holds the host-local, file-backed
# state — the Cloudflare/Tailscale tunnel and its binaries, pxpipe's install,
# headroom's process files and the machine id — which resets on every restart
# without one.
#
# Debian rather than Alpine: better-sqlite3 is an optionalDependency with native
# bindings (used only to read Cursor's own local database when importing its
# credentials) and publishes glibc prebuilds. On musl it would be compiled from
# source at install time, or silently skipped.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci`, never `npm install`: a build must not resolve a version the lockfile
# does not record. Dev dependencies are needed here because the build runs
# `prisma contract emit` through the prebuild script.
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Unset so `output: "standalone"` stays on — next.config.ts disables it when
# VERCEL is present, because Vercel's adapter expects the normal tracing layout.
ENV VERCEL=""
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# The whole reason this image exists. Anything under here must be a mounted
# volume; without one the container is as ephemeral as the serverless host.
ENV DATA_DIR=/data
ENV PORT=20128
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Run unprivileged, and make the data directory writable by that user — the
# image's `node` user does not own /data by default, and an unwritable DATA_DIR
# is exactly the degraded mode this image is meant to avoid.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 20128

# Hits the one route that needs no auth (PUBLIC_API_PATHS in dashboardGuard).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||20128)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
