# SBOM — Software Bill of Materials

## Инструмент

Syft (anchore/syft) — генерация SBOM в формате CycloneDX JSON.

## Задача для DevOps

Добавить в .gitlab-ci.yml джоб после каждого build_* джоба:

  sbom_api:
    stage: pack
    tags: [kube-stage]
    image: anchore/syft:latest
    needs: [build_api]
    dependencies: [build_api]
    rules: !reference [.rules, dev]
    script:
      - syft registry:${CI_REGISTRY_IMAGE}/api:${CI_COMMIT_SHORT_SHA}
          --output cyclonedx-json
          --file sbom-api.json
    artifacts:
      name: "sbom-api-${CI_COMMIT_SHORT_SHA}"
      paths:
        - sbom-api.json
      expire_in: 90 days

  # Аналогично для web, relay, search, mesh, giga, scout

## Закрепить версию syft

Заменить image: anchore/syft:latest на конкретную версию:
  image: anchore/syft:v1.18.0

## Альтернатива — локальная генерация

Для разработчика без доступа к CI:

  # Установить syft
  curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin

  # Сгенерировать SBOM из директории
  syft dir:. --output cyclonedx-json --file sbom-local.json

  # Сгенерировать из Docker-образа (после локальной сборки)
  syft registry:portal-api:local --output cyclonedx-json --file sbom-api.json

## Статус

Ожидает подключения DevOps.
Задача: добавить syft-джобы в .gitlab-ci.yml и настроить хранение артефактов.
