# Target-binding для dispatch

`validateDispatch` — общий safety gate для API handoff в relay/device-agent.

Источники канонических значений: `accountId` — scope аккаунта и `slice_jobs.account_id`;
`sliceJobId` — готовая `slice_jobs`; `profileHash` — хэш профиля, зафиксированный результатом
слайсинга; `configFingerprint` — `user_printers.config_fingerprint`; `nozzleFingerprint` —
актуальный capability snapshot устройства.

Текущая `slice_jobs` не является источником последних трёх значений: API не должен выводить их
из `profile_id`, `slice_key` или opaque `metrics`. До появления канонической связи handoff должен
отклоняться как небезопасный. Отказ не создаёт device job и не меняет relay.

Потребитель подключает контракт как `@portal/contracts/device-dispatch`; порядок проверок и
коды отказа являются частью handoff-контракта. В частности, `TARGET_OFFLINE` и `CANCELLED`
проверяются только после всех сравнений идентичности, чтобы причина отказа оставалась
детерминированной.

## Fingerprint trust policy v1

`evaluateFingerprintPolicy` — fail-closed policy для подписанного результата Mesh. Поля
`accountId`, `deviceId`, `profileId`, `sliceKey`, `configFingerprint`, `algorithmVersion` и
состояние доказательства входят в `signatureMaterial`; криптографический verifier передаётся
владельцем ключа через `verifySignature`.

| Состояние | Источник | account scope | global scope |
|---|---|---:|---:|
| `agent` | `agent`, свежий подписанный fingerprint; `canonicalFingerprint` совпадает | allow | allow |
| `declared` | только заявление аккаунта | allow при точном совпадении | reject |
| `modified` | `agent`, custom fingerprint, `canonicalFingerprint=null` | allow при точном совпадении | reject |
| `revoked` | любой | reject | reject |
| `stale` | любой / истёкший `expiresAt` | reject | reject |
| `unknown` | нет доказательства | reject | reject |

Ни один отказ не вызывает fallback/hit. Повторный `attestationId` должен быть передан в
`seenAttestationIds` и получает `REPLAYED_ATTESTATION`; старый contract или algorithm version
получает отказ до проверки подписи. Fixture-матрица: `fixtures/fingerprint-trust.v1.json`.
