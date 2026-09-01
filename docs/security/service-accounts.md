# Service Accounts — минимальные права сервисов

## Текущее состояние

Все сервисы используют единый ServiceAccount `vault`. 
securityContext и podSecurityContext пусты во всех Helm values.

## Задачи для DevOps

### 1. Отдельные ServiceAccount для каждого сервиса

Создать отдельные SA вместо общего `vault`:

| Сервис | SA | Vault path |
|--------|-----|------------|
| api | `aiportal-api` | `rndml/aiportal/api` |
| relay | `aiportal-relay` | `rndml/aiportal/relay` |
| search | `aiportal-search` | `rndml/aiportal/search` |
| mesh | `aiportal-mesh` | `rndml/aiportal/mesh` |
| giga | `aiportal-giga` | `rndml/aiportal/giga` |
| scout | `aiportal-scout` | `rndml/aiportal/scout` |
| web | нет SA | нет секретов |

В каждом envs/dev/*.yaml заменить:
  serviceAccount:
    create: false
    name: vault

На:
  serviceAccount:
    create: true
    name: aiportal-<service>
    annotations:
      vault.hashicorp.com/role: d-rndml-aiportal-<service>

Создать отдельные Vault roles с доступом только к своему пути.

### 2. securityContext для каждого сервиса

Добавить в каждый envs/dev/*.yaml:

  podSecurityContext:
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault

  securityContext:
    allowPrivilegeEscalation: false
    capabilities:
      drop: ["ALL"]
    readOnlyRootFilesystem: true

Исключения (readOnlyRootFilesystem: false):
- api — пишет в /srv/git/repos (git-репозитории)
- mesh — prusaslicer пишет временные файлы

### 3. NetworkPolicy

Ограничить входящий/исходящий трафик между сервисами:

| Сервис | Входящий | Исходящий |
|--------|----------|-----------|
| api | ingress, relay:9092 | mesh:3101, giga:3102, postgres, minio, vault |
| web | ingress | — |
| relay | устройства:8443 | api |
| search | — | postgres, minio, vault |
| mesh | api | minio, vault |
| giga | api | minio, vault |
| scout | — | внешние источники, postgres, vault |

## Статус

Ожидает реализации DevOps.
Приоритет: securityContext — высокий, отдельные SA — средний, NetworkPolicy — низкий.
