# Локальный dev-postgres: pgvector (MF-1014/MF-1018) + PostGIS (MF-1000) в одном образе —
# managed cloud.ru прод получает оба extension'а отдельно через заявку Ops, этот файл только
# для docker compose (compose.yaml), не деплоится сам по себе.
FROM pgvector/pgvector:pg16

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-postgis-3 postgresql-16-postgis-3-scripts \
    && rm -rf /var/lib/apt/lists/*
