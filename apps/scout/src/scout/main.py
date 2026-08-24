"""FastAPI-приложение apps/scout: только /health (MF-623).

Внутренний сервис без публичного порта (тот же паттерн, что apps/mesh и
apps/giga — см. их main.py) — scout ничего не отдаёт наружу, вся полезная
работа идёт через `worker.py`/`sources/*` прямо в Postgres.
"""

from __future__ import annotations

from fastapi import FastAPI

app = FastAPI(title="scout")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "scout"}
