# Verified multi-platform manifest digests; update with dependency / container checks.
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Optional build secret `build_ca`: an extra CA for TLS-intercepting proxies (see compose.build-ca.yaml). Never baked into a layer.
RUN --mount=type=secret,id=build_ca,required=false sh -c '[ -s /run/secrets/build_ca ] && export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; npm_config_update_notifier=false npm install --global pnpm@11.19.0'
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
RUN --mount=type=cache,id=ledger-pnpm,target=/pnpm/store --mount=type=secret,id=build_ca,required=false \
    sh -c '[ -s /run/secrets/build_ca ] && export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; pnpm install --frozen-lockfile --store-dir /pnpm/store'

FROM dependencies AS source
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

FROM source AS builder
RUN pnpm build

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/cluster.mjs ./apps/web/cluster.mjs
USER node
EXPOSE 3000
# WEB_CONCURRENCY server processes share the port (default: one per CPU, at most 4).
CMD ["node", "apps/web/cluster.mjs"]

FROM source AS worker
USER node
# Run node directly so SIGTERM reaches the worker and a graceful stop exits 0.
CMD ["node", "--import", "tsx", "apps/worker/src/index.ts"]

# Local protocol mocks for third-party services (compose.mock.yaml); never part of a production deployment.
FROM source AS mock-services
USER node
CMD ["node", "--import", "tsx", "apps/mock-services/src/index.ts"]

FROM source AS migrate
USER node
CMD ["node", "--import", "tsx", "packages/db/src/migrate.ts"]

FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27 AS tests
WORKDIR /app
COPY --from=source /app /app
ENV CI=1
# Run Playwright directly: `pnpm run` would re-verify node_modules against the build-time store and reinstall from the registry.
CMD ["node_modules/.bin/playwright", "test"]

# Lint, format, typecheck, unit tests, contract and progress checks with only Docker on the host: `docker build --target verify .`
# (a failing check fails the build). `--target verify-report --output .` also writes coverage/ to the checkout.
FROM source AS verify
RUN pnpm lint && pnpm format:check && pnpm typecheck && pnpm test:unit && pnpm contract:check && node scripts/progress.mjs validate

FROM scratch AS verify-report
COPY --from=verify /app/coverage /coverage

# Docker CLI with the Compose and Buildx plugins (static binaries) for the toolbox.
FROM docker:29-cli@sha256:b1805116a6a86cc591b5d5f60a910a0715cdcc9d18d866ad68b1457ead25c35c AS docker-cli

# Repository scripts (setup-env, test:e2e / test:perf / test:ops, progress) without Node.js on the host. compose.tools.yaml
# mounts the checkout at /work plus the engine socket; the scripts use only Node built-ins, and nested stacks run on the host engine.
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS toolbox
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
WORKDIR /work
