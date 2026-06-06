# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Obikai web-admin image — build the Vite SPA, serve the static bundle with Caddy.
#
#   docker build -f docker/web-admin.Dockerfile -t obikai-web-admin .
#
# The served Caddyfile is GENERATED from the TS source-of-truth (docker/web/gen-headers.ts,
# ADR-0008) so the CSP/security headers stay tested in TypeScript, never hand-authored. TLS and
# per-tenant hostname routing are handled upstream by Traefik (docker-compose.prod.yml); Caddy
# listens on a plain :8080 behind it and serves the SPA with immutable asset caching + SPA fallback.
# The SPA calls the api at same-origin `/api` (Traefik routes it), so `connect-src 'self'` suffices.
# ─────────────────────────────────────────────────────────────────────────────

# ── build ───────────────────────────────────────────────────────────────────--
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo
# Copy only what the build graph needs, to maximise layer-cache hits.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json .npmrc* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY adapters ./adapters
COPY apps ./apps
COPY docker ./docker
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
# Build web-admin and its workspace deps (turbo resolves the order); then render the Caddyfile.
RUN pnpm exec turbo run build --filter=@obikai/web-admin
RUN node --experimental-strip-types docker/web/gen-headers.ts \
    docker/web/Caddyfile.template /repo/Caddyfile

# ── runtime ─────────────────────────────────────────────────────────────────--
FROM caddy:2-alpine AS runtime
# Static bundle + generated, security-hardened Caddyfile. Caddy's default entrypoint runs this.
COPY --from=build /repo/apps/web-admin/dist /srv
COPY --from=build /repo/Caddyfile /etc/caddy/Caddyfile
# Fail the build if gen-headers produced an invalid Caddyfile — this is the CI gate that the
# TS-generated CSP/security-headers (docker/web/gen-headers.ts, ADR-0008) parse in real Caddy.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
EXPOSE 8080
