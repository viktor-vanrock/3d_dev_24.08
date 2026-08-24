# syntax=docker/dockerfile:1.7

# Build from the portal.ru repository root:
#   docker build -f apps/api/Dockerfile -t portal-api .
ARG NODE_IMAGE=registry.sberdevices.ru/rndml/devops/dockerfiles/nodejs-runtime-24:24.13

FROM ${NODE_IMAGE} AS builder

USER root
WORKDIR /workspace

RUN npm install --global pnpm@9.15.0

# Install only the API workspace and its local dependencies. Keeping manifests in a
# separate layer lets CI reuse the dependency cache when application sources change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/install-git-hooks.mjs scripts/install-git-hooks.mjs
COPY apps/api/package.json apps/api/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile --filter @portal/api...

COPY packages/config/tsconfig.base.json packages/config/tsconfig.base.json
COPY packages/contracts/db-rows packages/contracts/db-rows
COPY packages/contracts/device-agent-runtime packages/contracts/device-agent-runtime
COPY packages/contracts/device-dispatch packages/contracts/device-dispatch
COPY packages/contracts/device-protocol packages/contracts/device-protocol
COPY packages/contracts/http packages/contracts/http
COPY packages/contracts/jobs packages/contracts/jobs
COPY packages/contracts/printer-api packages/contracts/printer-api
COPY packages/contracts/printer-driver packages/contracts/printer-driver
COPY packages/contracts/project-manifest packages/contracts/project-manifest
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src

# Node refuses to strip TypeScript from a package physically located under
# node_modules. Keep the source-only contracts workspace outside node_modules
# and point the package link at its real path, matching local pnpm semantics.
RUN pnpm --filter @portal/api run build \
    && pnpm --filter @portal/api --prod deploy /runtime \
    && rm -rf /runtime/src /runtime/tsconfig.json /runtime/tsconfig.tsbuildinfo \
    && mkdir -p /runtime/packages \
    && cp -R packages/contracts /runtime/packages/contracts \
    && rm -rf /runtime/packages/contracts/node_modules \
    && rm -rf /runtime/node_modules/@portal/contracts \
    && ln -s ../../packages/contracts /runtime/node_modules/@portal/contracts \
    && ln -s .pnpm/node_modules/ajv /runtime/node_modules/ajv \
    && ln -s ../../node_modules/.pnpm/node_modules /runtime/packages/contracts/node_modules

FROM ${NODE_IMAGE} AS runtime

USER root
WORKDIR /app

# The API manages Git-backed project repositories at runtime. dbmate is kept in the
# image so the same artifact can be used by a GitLab migration job or at startup.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global dbmate@2.33.0

COPY --from=builder --chown=node:node /runtime ./
COPY --chown=node:node apps/api/db ./db

ENV NODE_ENV=production \
    PORT=3002

USER node
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

# Matches the current deployment contract: apply dbmate migrations before starting
# Nest. GitLab/Helm may override the command and run migrations as a separate job.
CMD ["sh", "-c", "dbmate --migrations-dir db/migrations --schema-file db/schema.sql --no-dump-schema up && exec node dist/nest/main.js"]
