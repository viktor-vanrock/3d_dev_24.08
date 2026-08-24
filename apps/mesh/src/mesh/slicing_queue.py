"""Domain helpers for the fenced slicing worker.

CPU-тяжёлая работа (вызов внешнего headless-слайсера, MF-989) сознательно вне
HTTP-запроса `apps/api`; `slicing_worker.py` запускает его отдельным процессом,
независимым от `revision_worker.py`
(разная кардинальность: конвертация гоняется на каждую загрузку, слайсинг — по запросу
юзера, оба CPU-тяжёлые, совмещать в один poll-луп значит, что медленный слайс держит
очередь конвертации, см. docs/architecture/readme.md — процессы независимы).

## Per-account slice-кэш (Data-вето MF-1078, docs/epics/slicer.profiles.md/data.fragmentation.md)

`slice_cache_entries` (MF-1073) — content-addressed индекс внутри account_id: по
 попаданию нельзя узнать, чью модель кто-то слайсил. Каждый аккаунт имеет свой ключ,
физически шарится между аккаунтами, если не гейтить на уровне запроса — а v1-решение
CTO (MF-1075 п.1) явно ограничивает кэш per-account, без P2P/глобального дедупа.

Гейт реализован здесь, не в схеме: `slice_cache_hits(slice_key, user_id, model_id)` —
append-only список "кто уже видел этот slice_key". Отдать готовый g-code без пересчёта
можно, ТОЛЬКО если для (slice_key, requested_by) уже есть строка в `slice_cache_hits`
(т.е. этот же аккаунт сам когда-то досчитал этот slice_key). Первое попадание другого
аккаунта на тот же slice_key ВСЕГДА пересчитывается заново (пусть даже физически
идентичный g-code уже лежит в `slice_cache_entries`) — после чего аккаунт получает свою
строку в `slice_cache_hits` и на следующий запрос уже получает кэш-хит. Так `slice_key`
остаётся общим техническим индексом (экономит хранение — один и тот же файл не льётся
в S3 повторно под разными ключами), а privacy-контракт "чужой уже посчитанный g-code
никому не течёт по факту первого совпадения" держится в коде выдачи, не в схеме.

## Движки: PrusaSlicer (легаси) и Orca/Snapmaker U1 (MF-1987)

`_resolve_slicer_engine` роутит job по `slicer_profiles.slicer` для job-level
`profile_id`: `prusaslicer` → легаси одномодельный путь (`_run_prusaslicer_job`,
единый `model_id`); `orcaslicer` c непустым `job["layout"]` → мульти-инстанс
плита ОДНОГО пиненного project artifact на U1 (`_run_orca_plate_job`,
project-slice-request.v1, решение MF-1981/карточка MF-1987) — Mesh только
читает уже стейдженные Back'ом (MF-1986, `20260719210000_slice_job_plate_layout.sql`)
артефакты по ключу, режет реальный `orca-slicer` и публикует preview-манифест
`slice-preview.v1`. Job без `layout` держит одномодельный PrusaSlicer-путь.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from collections.abc import Callable
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from .slice_trust import (
    SignedSliceTrust,
    SliceTrustError,
    Verifier,
    build_slice_trust_material,
    verify_slice_trust_material,
)
from .slice_trust_signing import (
    SliceTrustSigningConfigError,
    build_signer,
    build_verifier,
    load_slice_trust_signing_config,
)
from .slicer_engine import (
    SlicerEngineConfig,
    SlicingError,
    UnsupportedSlicerError,
    resolve_prusa_ini,
    run_prusaslicer,
)
from .slicer_preflight import check_bed_origin
from .snapmaker_u1_profile import (
    SnapmakerProfileError,
    resolve_snapmaker_u1_profile,
)
from .snapmaker_u1_slice import (
    PlateInstanceInput,
    SnapmakerU1PlateSliceResult,
    slice_snapmaker_u1_plate,
)
from .storage import (
    ObjectStore,
    legacy_canonical_3mf_key,
    slice_gcode_key,
    slice_preview_manifest_key,
)

logger = logging.getLogger("mesh.slicing_queue")

_ENGINE_VERSION = "prusaslicer-mvp1"
_PREVIEW_MANIFEST_VERSION = "slice-preview.v1"



def _find_account_cache_hit(
    conn: psycopg.Connection,
    slice_key: bytes,
    user_id: str | None,
    *,
    trust_material: dict | None = None,
    verifier: Verifier | None = None,
) -> dict | None:
    """Кэш-хит только если ЭТОТ аккаунт уже видел `slice_key` (см. докстринг модуля).
    `user_id is None` (легаси/без сессии) никогда не бьёт в кэш — не с кем сверять owner.
    """
    if user_id is None:
        return None
    if trust_material is not None:
        checked_material = build_slice_trust_material(trust_material)
        if checked_material["account_id"] != user_id:
            raise SliceTrustError("SLICE_TRUST_CONFLICT", "job owner differs from signed account")
        if slice_key != bytes.fromhex(checked_material["slice_key"]):
            raise SliceTrustError(
                "SLICE_TRUST_CONFLICT", "requested slice key differs from signed material"
            )
        with conn.cursor() as cur:
            cur.execute(
                """
                select e.gcode_s3_key, e.size_bytes, e.metrics,
                       e.slice_trust_contract_version, e.slice_trust_material,
                       e.slice_trust_key_id, e.slice_trust_signature,
                       h.user_id
                  from slice_cache_entries e
                  left join slice_cache_hits h
                    on h.account_id = e.account_id and h.slice_key = e.slice_key
                   and h.user_id = %s
                 where e.account_id = %s and e.slice_key = %s
                 limit 1
                """,
                (user_id, user_id, slice_key),
            )
            row = cur.fetchone()
        if row is None:
            return None
        if verifier is None:
            raise SliceTrustError(
                "SLICE_TRUST_SIGNATURE_INVALID", "signature verifier is not configured"
            )
        if row[3] != "slice-trust.v1" or row[4] is None or row[5] is None or row[6] is None:
            raise SliceTrustError(
                "SLICE_TRUST_VERSION_UNSUPPORTED",
                "legacy cache result has no slice-trust.v1 evidence",
            )
        entry_material = build_slice_trust_material(row[4])
        evidence = SignedSliceTrust(entry_material, row[5], row[6])
        verify_slice_trust_material(checked_material, evidence, verifier)
        if row[7] is None:
            # Existing account entry is valid evidence but this user has not yet
            # created a hit for this model/key; preserve the existing per-account
            # gate and force a real slice on first use.
            return None
        return {
            "gcode_s3_key": row[0],
            "size_bytes": row[1],
            "metrics": row[2],
            "signed_trust": SignedSliceTrust(entry_material, row[5], row[6]),
        }
    with conn.cursor() as cur:
        cur.execute(
            """
            select e.gcode_s3_key, e.size_bytes, e.metrics
              from slice_cache_hits h
              join slice_cache_entries e
                on e.account_id = h.account_id and e.slice_key = h.slice_key
             where h.account_id = %s and h.slice_key = %s and h.user_id = %s
             limit 1
            """,
            (user_id, slice_key, user_id),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return {"gcode_s3_key": row[0], "size_bytes": row[1], "metrics": row[2]}


def _assert_cache_entry_material_compatible(
    conn: psycopg.Connection,
    slice_key: bytes,
    account_id: str,
    signed_trust: SignedSliceTrust,
) -> None:
    """Проверяет cache material до любой записи в его S3 key.

    ``FOR UPDATE`` не блокирует отсутствующую строку. Без дополнительного
    transaction-scoped lock два concurrent job с одним account-scoped key могли
    оба пройти preflight и перезаписать один S3 object до того, как второй
    получил ``SLICE_TRUST_CONFLICT``.
    """
    with conn.cursor() as cur:
        cur.execute(
            "select pg_advisory_xact_lock(hashtextextended(%s, 0))",
            (f"{account_id}:{slice_key.hex()}",),
        )
        cur.execute(
            """
            select slice_trust_material
              from slice_cache_entries
             where account_id = %s and slice_key = %s
             for update
            """,
            (account_id, slice_key),
        )
        existing = cur.fetchone()
    if existing is None or existing[0] is None:
        if existing is not None:
            raise SliceTrustError(
                "SLICE_TRUST_VERSION_UNSUPPORTED",
                "legacy cache result has no slice-trust.v1 evidence",
            )
        return
    if build_slice_trust_material(existing[0]) != signed_trust.material:
        raise SliceTrustError(
            "SLICE_TRUST_CONFLICT",
            "cache result material differs from requested material",
        )


def _record_cache_entry_and_hit(
    conn: psycopg.Connection,
    slice_key: bytes,
    gcode_s3_key: str,
    size_bytes: int,
    metrics: dict,
    job_id: str,
    user_id: str,
    model_id: str,
    signed_trust: SignedSliceTrust | None = None,
    *,
    commit: bool = True,
) -> None:
    if signed_trust is not None:
        with conn.cursor() as cur:
            cur.execute(
                """
                select slice_trust_material
                  from slice_cache_entries
                 where account_id = %s and slice_key = %s
                 for update
                """,
                (user_id, slice_key),
            )
            existing = cur.fetchone()
            if existing is not None:
                if existing[0] is None:
                    raise SliceTrustError(
                        "SLICE_TRUST_VERSION_UNSUPPORTED",
                        "legacy cache result has no slice-trust.v1 evidence",
                    )
                if build_slice_trust_material(existing[0]) != signed_trust.material:
                    raise SliceTrustError(
                        "SLICE_TRUST_CONFLICT",
                        "cache result material differs from requested material",
                    )
            cur.execute(
                """
                insert into slice_cache_entries
                    (account_id, slice_key, gcode_s3_key, size_bytes,
                     slicer_engine_version, metrics, first_slice_job_id,
                     slice_trust_contract_version, slice_trust_material,
                     slice_trust_key_id, slice_trust_signature)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (account_id, slice_key) do update
                   set last_used_at = now(),
                       hit_count = slice_cache_entries.hit_count + 1
                """,
                (
                    user_id,
                    slice_key,
                    gcode_s3_key,
                    size_bytes,
                    _ENGINE_VERSION,
                    Jsonb(metrics),
                    job_id,
                    signed_trust.material["contract_version"],
                    Jsonb(signed_trust.material),
                    signed_trust.key_id,
                    signed_trust.signature,
                ),
            )
            cur.execute(
                """
                insert into slice_cache_hits (account_id, slice_key, user_id, model_id)
                values (%s, %s, %s, %s)
                on conflict (account_id, slice_key, user_id, model_id) do nothing
                """,
                (user_id, slice_key, user_id, model_id),
            )
        if commit:
            conn.commit()
        return
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into slice_cache_entries
                (account_id, slice_key, gcode_s3_key, size_bytes, slicer_engine_version, metrics,
                 first_slice_job_id)
            values (%s, %s, %s, %s, %s, %s, %s)
            on conflict (account_id, slice_key) do update
               set last_used_at = now(),
                   hit_count = slice_cache_entries.hit_count + 1
            """,
            (user_id, slice_key, gcode_s3_key, size_bytes, _ENGINE_VERSION, Jsonb(metrics), job_id),
        )
        cur.execute(
            """
            insert into slice_cache_hits (account_id, slice_key, user_id, model_id)
            values (%s, %s, %s, %s)
            on conflict (account_id, slice_key, user_id, model_id) do nothing
            """,
            (user_id, slice_key, user_id, model_id),
        )
    if commit:
        conn.commit()


def _touch_cache_entry(
    conn: psycopg.Connection,
    slice_key: bytes,
    account_id: str,
    *,
    commit: bool = True,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "update slice_cache_entries"
            " set last_used_at = now(), hit_count = hit_count + 1"
            " where account_id = %s and slice_key = %s",
            (account_id, slice_key),
        )
    if commit:
        conn.commit()


def _resolve_slicer_engine(conn: psycopg.Connection, profile_id: str) -> str:
    """`slicer_profiles.slicer` для job-level `profile_id` — не резолвит всю
    цепочку наследования (это `resolve_prusa_ini`/будущий generic-резолвер
    MF-16), только тег движка, нужный воркеру для роутинга джобы между
    PrusaSlicer (легаси, единый `model_id`) и Orca/U1 (MF-1987, `layout`)."""
    with conn.cursor() as cur:
        cur.execute("select slicer from slicer_profiles where id = %s", (profile_id,))
        row = cur.fetchone()
    if row is None:
        raise UnsupportedSlicerError(f"профиль {profile_id} не найден")
    return row[0]


def _run_prusaslicer_job(
    conn: psycopg.Connection,
    store: ObjectStore,
    engine_config: SlicerEngineConfig,
    model_id: str,
    profile_id: str,
    filament_profile_id: str | None,
    requested_by: str,
    slice_key: bytes,
) -> tuple[str, int, dict, str | None]:
    """Легаси одномодельный путь (MF-1078/MF-989) — единый `model_id` →
    canonical_3mf → PrusaSlicer. Возвращает (gcode_s3_key, size_bytes,
    metrics, preview_manifest_s3_key), ту же форму, что `_run_orca_plate_job`
    (легаси путь не публикует preview-манифест — последний элемент всегда
    `None`); `slicing_worker.execute_slice_job` возвращает оба пути в единой
    `SliceJobSuccess` форме."""
    ini_texts = [resolve_prusa_ini(conn, profile_id)[0]]
    merged_metrics: dict = {}
    if filament_profile_id is not None:
        filament_ini, filament_params = resolve_prusa_ini(conn, filament_profile_id)
        ini_texts.append(filament_ini)
        merged_metrics["filament_params"] = filament_params
    canonical_s3_key = _canonical_3mf_location(conn, model_id)
    # Release the read transaction before the external slicer runs. The queue
    # lease is maintained independently by the lifecycle heartbeat connection.
    conn.commit()

    with tempfile.TemporaryDirectory(prefix="mesh-slice-") as tmp:
        tmp_dir = Path(tmp)
        stl_path = tmp_dir / "model.3mf"
        store.download(canonical_s3_key, stl_path)

        gcode_path = tmp_dir / "output.gcode"
        run_prusaslicer(engine_config, stl_path, ini_texts, gcode_path)

        size_bytes = gcode_path.stat().st_size
        s3_key = slice_gcode_key(requested_by, slice_key.hex())
        store.upload(gcode_path, s3_key, content_type="text/x-gcode")
    return s3_key, size_bytes, merged_metrics, None


def _canonical_3mf_location(conn: psycopg.Connection, model_id: str) -> str:
    """Prefer the active revision asset; retain one explicit legacy compatibility read."""

    with conn.cursor() as cursor:
        cursor.execute(
            """
            select blobs.s3_key
              from models
              join model_revision_files files
                on files.model_revision_id = models.active_revision_id
               and files.role = 'canonical_3mf'
              join storage_blobs blobs on blobs.id = files.blob_id and blobs.state = 'ready'
             where models.id = %s::uuid
            """,
            (model_id,),
        )
        row = cursor.fetchone()
    if row is not None:
        return str(row[0])
    logger.warning(
        "model %s has no active revision canonical; using legacy compatibility key",
        model_id,
    )
    return legacy_canonical_3mf_key(model_id)


def _build_preview_manifest(result: SnapmakerU1PlateSliceResult, bed_geometry: dict) -> dict:
    """Конверт `slice-preview.v1` (MF-1987, project-slice-request.v1,
    решение MF-1981) — account-scoped JSON, обязателен per-instance summary:
    `instance_id`, `footprint_mm`, `supports_used`, `layer_count`. Точный
    формат per-layer toolpath-геометрии внутри решает Mesh (нет бизнес-логики
    в `packages/contracts`, `docs/architecture/service.map.md` §2) — MVP
    несёт агрегированные метрики плиты + per-instance summary, не полный
    toolpath."""
    return {
        "contract_version": _PREVIEW_MANIFEST_VERSION,
        "bed_geometry": bed_geometry,
        "metrics": {
            "print_time_seconds": result.metrics.print_time_seconds,
            "filament_used_g": result.metrics.filament_used_g,
            "filament_used_m": result.metrics.filament_used_m,
            "warnings": list(result.metrics.warnings),
        },
        "instances": [
            {
                "instance_id": instance.instance_id,
                "footprint_mm": instance.footprint_mm,
                "supports_used": instance.supports_used,
                "layer_count": instance.layer_count,
                "skipped": instance.skipped,
            }
            for instance in result.instances
        ],
    }


def _run_orca_plate_job(
    store: ObjectStore,
    orca_engine_config: SlicerEngineConfig | None,
    orca_profiles_dir: Path | None,
    layout: dict,
    intent: dict,
    requested_by: str,
    slice_key: bytes,
) -> tuple[str, int, dict, str | None]:
    """U1 Orca-путь плиты (MF-1987, project-slice-request.v1): скачивает уже
    стейдженные per-instance артефакты (Back резолвил/проверил sha256 —
    Mesh НЕ резолвит git/manifest сам, только читает байты по ключу job'ы),
    режет реальную multi-instance плиту (`snapmaker_u1_slice.slice_snapmaker_u1_plate`),
    публикует preview-манифест. Возвращает (gcode_s3_key, size_bytes, metrics,
    preview_manifest_s3_key); fenced lifecycle сохраняет манифест-ключ в
    `slice_jobs.preview_manifest_s3_key` (MF-1986), не в `metrics`.
    """
    if orca_engine_config is None:
        raise UnsupportedSlicerError(
            "движок orcaslicer не сконфигурирован (SLICER_ORCA_BINARY_PATH)"
        )
    if orca_profiles_dir is None:
        raise UnsupportedSlicerError(
            "вендорский бандл Orca не сконфигурирован (MESH_ORCA_PROFILES_DIR)"
        )

    profile = resolve_snapmaker_u1_profile(orca_profiles_dir)
    raw_bed_geometry = layout.get("bed_geometry")
    bed_geometry = raw_bed_geometry or profile.build_volume_mm
    raw_instances = layout.get("instances") or []
    if not raw_instances:
        raise SlicingError("layout.instances пуст — нечего слайсить")

    # MF-1992: `layout.bed_geometry.origin` (packages/contracts/jobs/slicer-plate.ts)
    # различает `center` (координаты от центра стола, именно так всегда шлёт
    # apps/web/src/plate/platescreen.tsx) и `front_left`/`explicit` (от угла) —
    # тот же сдвиг, что apps/api/src/models/platePreflight.ts::bedRectBounds делает
    # перед своим preflight. `check_plate_layout`/`build_plate_3mf` ниже по стеку
    # всегда работают в corner-origin [0, bed.x]×[0, bed.y] (нет собственного
    # понятия origin) — без сдвига здесь центрированная раскладка получала бы
    # ложный `outside_bed` на границе даже для валидной раскладки.
    offset_x = offset_y = 0.0
    if raw_bed_geometry is not None:
        origin = raw_bed_geometry.get("origin")
        check_bed_origin(origin)  # MF-1994: неизвестный origin — честный отказ, не 0-сдвиг
        if origin == "center":
            offset_x = float(raw_bed_geometry.get("width_mm") or profile.build_volume_mm["x"]) / 2.0
            offset_y = float(raw_bed_geometry.get("depth_mm") or profile.build_volume_mm["y"]) / 2.0

    with tempfile.TemporaryDirectory(prefix="mesh-slice-plate-") as tmp:
        tmp_dir = Path(tmp)
        instances: list[PlateInstanceInput] = []
        for raw in raw_instances:
            instance_id = str(raw["instance_id"])
            artifact_key = raw.get("artifact_key")
            if not artifact_key:
                # API стейджит best-effort (slicing.route.ts) — job может быть
                # создана до того, как байты реально доехали до S3. Честный
                # отказ вместо попытки скачать объект по ключу "None".
                raise SlicingError(
                    f"инстанс {instance_id}: artifact_key отсутствует — "
                    "staging на API-стороне не удался"
                )
            artifact_path = tmp_dir / f"{instance_id}.stl"
            store.download(str(artifact_key), artifact_path)
            instances.append(
                PlateInstanceInput(
                    instance_id=instance_id,
                    stl_path=artifact_path,
                    x_mm=float(raw["x_mm"]) + offset_x,
                    y_mm=float(raw["y_mm"]) + offset_y,
                    rotation_z_deg=float(raw.get("rotation_z_deg", 0.0)),
                    scale=float(raw.get("scale", 1.0)),
                    toolhead_index=int(raw.get("toolhead_index", 0)),
                )
            )

        gcode_path = tmp_dir / "plate.gcode"
        result = slice_snapmaker_u1_plate(
            orca_engine_config,
            profile,
            instances,
            gcode_path,
            supports=str(intent.get("supports", "off")),
        )

        size_bytes = gcode_path.stat().st_size
        s3_key = slice_gcode_key(requested_by, slice_key.hex())
        store.upload(gcode_path, s3_key, content_type="text/x-gcode")

        manifest = _build_preview_manifest(result, bed_geometry)
        manifest_key = slice_preview_manifest_key(requested_by, slice_key.hex())
        store.upload_bytes(
            json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
            manifest_key,
            content_type="application/json",
        )

    metrics = {
        "print_time_seconds": result.metrics.print_time_seconds,
        "filament_used_g": result.metrics.filament_used_g,
        "filament_used_m": result.metrics.filament_used_m,
        "warnings": list(result.metrics.warnings),
    }
    return s3_key, size_bytes, metrics, manifest_key



def _orca_startup_health_check(
    orca_engine_config: SlicerEngineConfig | None,
    orca_profiles_dir: Path | None,
) -> tuple[SlicerEngineConfig | None, Path | None]:
    """Проверяет исполняемость `SLICER_ORCA_BINARY_PATH` и читаемость/валидность
    бандла `MESH_ORCA_PROFILES_DIR` ОДИН РАЗ при старте воркера (MF-1988) —
    без этого misconfiguration (не тот путь, недостача прав, повреждённый
    бандл) всплывала бы только на первой реальной Orca/U1 job'е, пряча
    инфраструктурную ошибку за задержкой до первой джобы. При провале
    деградирует к тому же паттерну, что и отсутствующий бинарь/директория
    (см. `load_orca_engine_config` докстринг) — Orca/U1 job'ы простаивают,
    легаси PrusaSlicer-путь продолжает работать, воркер не падает целиком.
    """
    if orca_engine_config is None or orca_profiles_dir is None:
        return orca_engine_config, orca_profiles_dir

    binary = Path(orca_engine_config.binary_path)
    if not binary.is_file() or not os.access(binary, os.X_OK):
        logger.error(
            "SLICER_ORCA_BINARY_PATH=%s не найден или не исполняемый — "
            "Orca/U1 job'ы простаивают",
            orca_engine_config.binary_path,
        )
        return None, None

    try:
        resolve_snapmaker_u1_profile(orca_profiles_dir)
    except SnapmakerProfileError as exc:
        logger.error(
            "MESH_ORCA_PROFILES_DIR=%s: бандл профилей нечитаем/невалиден (%s) — "
            "Orca/U1 job'ы простаивают",
            orca_profiles_dir,
            exc,
        )
        return None, None

    logger.info(
        "Orca startup health OK: binary=%s profiles_dir=%s",
        orca_engine_config.binary_path,
        orca_profiles_dir,
    )
    return orca_engine_config, orca_profiles_dir


def _slice_trust_startup_health_check() -> tuple[
    Callable[[str], tuple[str, str]] | None, Verifier | None
]:
    """Грузит Ed25519 signer/verifier `slice-trust.v1` (MF-1992) один раз при
    старте воркера. Без него КАЖДАЯ job после cache miss падает
    `SLICE_TRUST_SIGNATURE_INVALID` (обязательный контракт с MF-1992) —
    тот же класс misconfiguration,
    что отсутствующий Orca-бинарь/бандл в `_orca_startup_health_check`, только
    здесь блокирует ВЕСЬ путь слайсинга, не только Orca/U1.

    `MESH_SLICE_TRUST_PRIVATE_KEY_PATH`/`MESH_SLICE_TRUST_KEY_ID` не заданы →
    воркер простаивает по всей очереди, тот же паттерн "нет кредов — не падает",
    что и отсутствие S3/DATABASE_URL/бинаря слайсера (см. блок ниже). Заданы, но
    файл битый/не Ed25519 → тот же деградированный простой, а не падение
    процесса — misconfiguration видна по громкому `ERROR`, не рестарт-лупит
    systemd. Лог никогда не включает ключ/подпись — только `key_id` и число
    известных публичных ключей.
    """
    try:
        signing_config = load_slice_trust_signing_config()
    except SliceTrustSigningConfigError as exc:
        logger.error("slice-trust.v1 signing misconfigured: %s", exc)
        return None, None
    if signing_config is None:
        return None, None
    logger.info(
        "slice-trust.v1 signing OK: key_id=%s known_public_keys=%d",
        signing_config.key_id,
        len(signing_config.public_keys),
    )
    return build_signer(signing_config), build_verifier(signing_config)
