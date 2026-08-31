# Security Exceptions

## EXCEPTION-001 — Python dependency audit not run

| Поле | Значение |
|------|----------|
| Риск | pip-audit не запускался: не установлен в WSL-среде. Python-пакеты apps/search, apps/mesh, apps/giga, apps/scout не проверены |
| Владелец | @твой-username |
| Компенсирующая мера | uv.lock зафиксирован; Python-сервисы изолированы в отдельных контейнерах; прямого разбора пользовательского YAML в Python-сервисах не обнаружено |
| Срок | 2026-09-01 |
| Действие | uv tool install pip-audit && pip-audit на каждый apps/*/uv.lock |
