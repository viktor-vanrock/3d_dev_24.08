"""Пиненный корпус SO-ARM100 (MF-1974) — реальные STL из апстрима
`TheRobotStudio/SO-ARM100` (Apache-2.0), не committed в репозиторий (тот же
принцип, что CI-провижининг бинарей слайсеров, MF-1918: скачать по пиненному
адресу и сверить sha256, не хранить бинарник в git). Живые тесты, которым нужен
этот корпус, обязаны `pytest.skip` на любой сбой сети/несовпадение хэша — это
внешний источник, не наш инпут-конвейер (`mesh/stl_reader.py` защищает от
враждебного пользовательского аплоада; здесь источник — пиненный коммит
известного open-source репозитория, доверенный на уровне "сверили хэш", а не
"проверили как чужой аплоад").

Набор и порядок артефактов (`gauge_loose` → `gauge_tight` → `follower_plate`)
зафиксированы оператором в карточке MF-1974 (комментарий 2026-07-19) и
совпадают с примером `artifacts:` в `docs/product/project.as.code.md` §
«Как агент оформляет реальные этапы» (`gauge-loose`/`follower-plate` —
`upstream.commit` того же пиненного коммита). Маленькие калибровочные
шаблоны первыми — дешёвый быстрый сигнал (секунды), прежде чем гонять
дорогую плиту (десятки секунд/минуты реального headless-слайса).
"""

from __future__ import annotations

import hashlib
import urllib.request
from pathlib import Path

COMMIT_SHA = "fda892cba81032c46c40976a48c9ceadbf40a9ca"
REPO = "TheRobotStudio/SO-ARM100"
LICENSE = "Apache-2.0"
_RAW_BASE = f"https://raw.githubusercontent.com/{REPO}/{COMMIT_SHA}"

# name -> (repo-relative path, ожидаемый sha256) — зафиксировано живым фетчем
# этой карточки (MF-1974), см. комментарий в issue. Ключи совпадают по духу
# с artifact id из `docs/product/project.as.code.md` (`gauge-loose`/
# `follower-plate`), не байт-в-байт (там дефис, здесь snake_case модуля).
FILES: dict[str, tuple[str, str]] = {
    "gauge_loose": (
        "STL/Gauges/Gauge_0.STL",
        "ba5b60f80ac9a47b1ba92c8c7d28e3128717e9497f6cc289f8d1e31a0243eb41",
    ),
    "gauge_tight": (
        "STL/Gauges/Gauge_tight_1.STL",
        "8cc075ed3ead3a7de08fbfd15e44e9be0fae61798b8672ebff1df2005ff918dc",
    ),
    "follower_plate": (
        "STL/SO101/Follower/Ender_Follower_SO101.stl",
        "f39e984d51f5ffd716bc7af5fbce31d7ef02bcd067ad6308ef597a7999f0a086",
    ),
}


class So101FixtureUnavailable(Exception):
    """Сеть недоступна или содержимое апстрима разошлось с пиненным хэшем —
    вызывающий тест обязан `pytest.skip`, не падать (внешняя зависимость)."""


def fetch(name: str, dest_dir: Path, *, timeout: float = 30.0) -> Path:
    if name not in FILES:
        raise KeyError(f"неизвестная фикстура SO-101: {name}")
    rel_path, expected_sha256 = FILES[name]
    dest = dest_dir / Path(rel_path).name
    url = f"{_RAW_BASE}/{rel_path}"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:  # noqa: S310 — пиненный HTTPS raw.githubusercontent.com
            data = response.read()
    except OSError as exc:
        raise So101FixtureUnavailable(f"не удалось скачать {url}: {exc}") from exc

    actual_sha256 = hashlib.sha256(data).hexdigest()
    if actual_sha256 != expected_sha256:
        raise So101FixtureUnavailable(
            f"{rel_path}@{COMMIT_SHA[:12]}: sha256 разошёлся — ожидали {expected_sha256}, "
            f"получили {actual_sha256} (апстрим изменил файл на пиненном коммите? "
            "не должно случиться, но сеть не доверяем молча)"
        )
    dest.write_bytes(data)
    return dest
