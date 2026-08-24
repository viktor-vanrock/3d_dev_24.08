# syntax=docker/dockerfile:1.7

ARG PYTHON_IMAGE=python:3.12-slim-trixie
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.11.6

FROM ${UV_IMAGE} AS uv

FROM ${PYTHON_IMAGE} AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv

COPY --from=uv /uv /usr/local/bin/uv

WORKDIR /app/apps/search

COPY packages/python/portal-queue-lifecycle/pyproject.toml /app/packages/python/portal-queue-lifecycle/pyproject.toml
COPY packages/python/portal-queue-lifecycle/src /app/packages/python/portal-queue-lifecycle/src
COPY apps/search/pyproject.toml apps/search/uv.lock ./

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project --no-editable

COPY apps/search/src ./src

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

FROM ${PYTHON_IMAGE} AS runtime

RUN groupadd --gid 10001 portal \
    && useradd --uid 10001 --gid portal --no-create-home --shell /usr/sbin/nologin portal

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
USER portal

STOPSIGNAL SIGTERM

CMD ["search-worker"]
