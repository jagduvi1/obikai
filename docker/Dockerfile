# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Obikai application image (api | worker) — one Dockerfile, two targets via ARG APP.
# Multi-stage: deps → build → prune → runtime. Build the whole workspace once,
# then `pnpm deploy` a single app's pruned production closure into the runtime.
#
#   docker build -f docker/Dockerfile --build-arg APP=api    -t obikai-api .
#   docker build -f docker/Dockerfile --build-arg APP=worker -t obikai-worker .
#
# Base image choice: we use node:22-bookworm-slim, NOT distroless. Distroless was
# considered (smaller surface, no shell) but rejected for this scaffold because
#   (a) some runtime deps (e.g. sharp/argon2/native bindings) expect glibc + the
#       occasional build-time toolchain, which slim provides cleanly, and
#   (b) a real shell keeps healthcheck/debug/entrypoint simple for self-hosters.
# The runtime still drops to a NON-root user and ships only the pruned prod tree.
# ─────────────────────────────────────────────────────────────────────────────

# ── deps ──────────────────────────────────────────────────────────────────────
# Resolve the full workspace dependency graph from the committed lockfile only.
FROM node:22-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo
# Copy only what pnpm needs to resolve the graph, to maximise layer cache hits.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY adapters ./adapters
COPY apps ./apps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── build ─────────────────────────────────────────────────────────────────────
# Compile every workspace package (tsc -b graph) against the installed deps.
FROM deps AS build
WORKDIR /repo
RUN pnpm -r build

# ── prune ───────────────────────────────────────────────────────────────────--
# Produce a self-contained production deployment for ONE app (ARG APP), with
# dev deps and other workspace apps stripped out.
FROM build AS prune
ARG APP
# Fail fast if the caller forgot --build-arg APP=api|worker.
RUN test -n "$APP" || (echo "ERROR: build ARG APP is required (api|worker)" >&2 && exit 1)
WORKDIR /repo
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --prod --filter="@obikai/${APP}" /app/out

# ── runtime ─────────────────────────────────────────────────────────────────--
# Minimal slim image, non-root, only the pruned prod closure + a compiled
# TS healthcheck. The same image serves api or worker; CMD differs only by APP.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# Re-declare ARG after FROM so it is visible in this stage too.
ARG APP
ENV OBIKAI_APP=${APP}
# node:* images already ship an unprivileged `node` user (uid 1000); reuse it.
WORKDIR /app
COPY --from=prune --chown=node:node /app/out ./
USER node
# Compiled TS healthcheck (see docker/web/gen-headers.ts comment re: TS sources).
# dist/healthcheck.js is produced by the app's own build; it exits 0 when ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "dist/healthcheck.js"]
# The app's package.json `main` resolves to dist/index.js for both api and worker.
CMD ["node", "dist/index.js"]
