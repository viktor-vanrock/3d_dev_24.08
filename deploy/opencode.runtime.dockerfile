# Изолированный OpenCode runtime для приватных assistant-тредов Portal (MF-2045).
# Версия зафиксирована deploy/opencode.runtime.version — общий источник истины
# для этого образа и deploy/opencode.runtime.rollout.sh (build/health/swap/rollback).
#
# НЕ путать с раннтаймом ocsearch на хосте `worker`
# (docs/process/hyperpc.local.llm.md) — тот обслуживает поисковых агентов
# флота Multica отдельным Linux-юзером, этот образ — под продуктовый
# assistant (apps/giga/apps/api), изоляция контейнером, без единого
# credential стороннего провайдера (только HYPERPC по Tailscale, см.
# entrypoint).
#
# opencode-ai — MIT (github.com/anomalyco/opencode, ранее sst/opencode),
# официальный headless-режим — `opencode serve` (OpenAPI на /doc).
FROM node:22-bookworm-slim

ARG OPENCODE_VERSION=1.18.4
ENV OPENCODE_VERSION=${OPENCODE_VERSION}

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl jq ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g "opencode-ai@${OPENCODE_VERSION}" \
    && npm cache clean --force

RUN useradd --create-home --shell /usr/sbin/nologin opencode
USER opencode
WORKDIR /home/opencode
ENV OPENCODE_CONFIG_DIR=/home/opencode/.config/opencode
RUN mkdir -p "$OPENCODE_CONFIG_DIR"

COPY --chown=opencode:opencode deploy/opencode.runtime.config.base.json /home/opencode/opencode.config.base.json
COPY --chown=opencode:opencode deploy/opencode.runtime.entrypoint.sh /home/opencode/entrypoint.sh

EXPOSE 4096
ENTRYPOINT ["/bin/sh", "/home/opencode/entrypoint.sh"]
