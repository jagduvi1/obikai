# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Obikai web-platform image — build the Vite SPA, serve the static bundle with Caddy.
#
#   docker build -f docker/web-platform.Dockerfile -t obikai-web-platform .
#
# The served Caddyfile is GENERATED from the TS source-of-truth (docker/web/gen-headers.ts,
# ADR-0008) so the CSP/security headers stay tested in TypeScript, never hand-authored. TLS and
# hostname routing are handled upstream by Traefik; Caddy listens on a plain :8080 behind it and
# serves the SPA with immutable asset caching + SPA fallback. The SPA calls the api at same-origin
# `/api` and `/platform` (Traefik routes them), so `connect-src 'self'` suffices.
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
# Build web-platform and its workspace deps (turbo resolves the order); then render the Caddyfile.
RUN pnpm exec turbo run build --filter=@obikai/web-platform
RUN node --experimental-strip-types docker/web/gen-headers.ts \
    docker/web/Caddyfile.template /repo/Caddyfile

# ── runtime ─────────────────────────────────────────────────────────────────--
FROM caddy:2-alpine AS runtime
# Static bundle + generated, security-hardened Caddyfile. Caddy's default entrypoint runs this.
COPY --from=build /repo/apps/web-platform/dist /srv
COPY --from=build /repo/Caddyfile /etc/caddy/Caddyfile
# Fail the build if gen-headers produced an invalid Caddyfile — CI gate for the TS-generated CSP.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
EXPOSE 8080
