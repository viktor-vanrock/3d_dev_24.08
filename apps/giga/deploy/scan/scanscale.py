"""Настоящий размер предмета из поз камеры.

Фотограмметрия восстанавливает форму с точностью до масштаба: предмет вдвое больше, снятый
вдвое дальше, даёт те же снимки. Но приложение знает, ГДЕ был телефон в момент каждого кадра —
ARKit меряет его путь в метрах. COLMAP восстанавливает те же позиции в своих условных
единицах. Отношение расстояний между парами позиций в двух системах — и есть масштаб, причём
поворот и сдвиг систем координат на него не влияют.

Отдельным модулем без зависимостей: математика проверяется на любой машине без FastAPI и GPU.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np

# Меньше — не статистика: пара выбросов COLMAP утащит медиану.
MIN_MATCHED = 8
MIN_RATIOS = 10
# Пары короче двух сантиметров пути не берём: на них дрожание рук сравнимо с самой базой.
MIN_AR_BASELINE_M = 0.02


def camera_center(qw: float, qx: float, qy: float, qz: float,
                  tx: float, ty: float, tz: float) -> tuple[float, float, float]:
    """Центр камеры из строки images.txt. COLMAP хранит переход мир→камера, поэтому центр —
    это -Rᵀt, а не сам t: перепутать — получить зеркальную геометрию и мусорный масштаб."""
    r00 = 1 - 2 * (qy * qy + qz * qz)
    r01 = 2 * (qx * qy - qz * qw)
    r02 = 2 * (qx * qz + qy * qw)
    r10 = 2 * (qx * qy + qz * qw)
    r11 = 1 - 2 * (qx * qx + qz * qz)
    r12 = 2 * (qy * qz - qx * qw)
    r20 = 2 * (qx * qz - qy * qw)
    r21 = 2 * (qy * qz + qx * qw)
    r22 = 1 - 2 * (qx * qx + qy * qy)
    # -Rᵀ t: транспонирование — чтение матрицы по столбцам.
    return (
        -(r00 * tx + r10 * ty + r20 * tz),
        -(r01 * tx + r11 * ty + r21 * tz),
        -(r02 * tx + r12 * ty + r22 * tz),
    )


def parse_images_txt(path: Path) -> dict[str, tuple[float, float, float]]:
    """Имя снимка → центр камеры. В images.txt на каждый снимок две строки: поза и список
    2D-точек; вторая не нужна и пропускается."""
    centers: dict[str, tuple[float, float, float]] = {}
    expecting_pose = True
    for line in path.read_text(errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if not expecting_pose:
            expecting_pose = True
            continue
        fields = line.split()
        if len(fields) < 10:
            continue
        try:
            numbers = [float(v) for v in fields[1:8]]
        except ValueError:
            continue
        centers[fields[9]] = camera_center(*numbers)
        expecting_pose = False
    return centers


def similarity_transform(
    ar_positions: dict[str, list[float]],
    colmap_centers: dict[str, tuple[float, float, float]],
) -> tuple[float, np.ndarray, np.ndarray] | None:
    """Полное подобие COLMAP → ARKit: масштаб s, поворот R, сдвиг t, так что p_ar ≈ s·R·p + t.

    Это больше, чем масштаб: перенеся ВЕСЬ меш в систему ARKit, получаем предмет в метрах,
    осью Y вверх (ARKit выровнен по гравитации) и со знанием, ГДЕ в сцене стоит зона съёмки, —
    без этого нельзя вырезать предмет из собранного стола.

    Метод Умеямы — наименьшие квадраты, и один грубый промах COLMAP валит его целиком: на
    синтетике точка, улетевшая на сотни единиц, утаскивала масштаб на два порядка, а обрезка
    по невязкам УЖЕ СЛОМАННОГО решения выбросов не находила — ломались все невязки разом.
    Поэтому выбросы ищутся ДО наименьших квадратов, по медианному масштабу (он у `metric_scale`
    доказанно переживает промахи): точка, чьи расстояния до остальных не бьются с робастным
    масштабом, в решение не входит.
    """
    names = sorted(set(ar_positions) & set(colmap_centers))
    if len(names) < MIN_MATCHED:
        return None

    robust_scale = metric_scale(ar_positions, colmap_centers)
    if robust_scale is None:
        return None

    ar = np.array([[float(v) for v in ar_positions[n][:3]] for n in names], dtype=np.float64)
    cm = np.array([colmap_centers[n] for n in names], dtype=np.float64)

    # Согласованность каждой точки с робастным масштабом: медиана |d_ar − s·d_colmap| по её
    # парам. У честной точки это шум трекинга (миллиметры), у промаха — метры.
    ar_d = np.linalg.norm(ar[:, None, :] - ar[None, :, :], axis=2)
    cm_d = np.linalg.norm(cm[:, None, :] - cm[None, :, :], axis=2)
    discrepancy = np.abs(ar_d - robust_scale * cm_d)
    np.fill_diagonal(discrepancy, np.nan)
    per_point = np.nanmedian(discrepancy, axis=1)
    keep = per_point <= max(float(np.median(per_point)) * 3.0, 0.01)
    if keep.sum() < MIN_MATCHED:
        return None

    fit = _umeyama(cm[keep], ar[keep])
    if fit is None:
        return None
    s, r, t = fit

    # Добор: после честного решения невязки уже осмысленны — один уточняющий проход.
    residuals = np.linalg.norm(ar[keep] - (cm[keep] @ r.T) * s - t, axis=1)
    tight = residuals <= max(float(np.median(residuals)) * 3.0, 1e-6)
    if tight.sum() >= MIN_MATCHED and tight.sum() < keep.sum():
        refit = _umeyama(cm[keep][tight], ar[keep][tight])
        if refit is not None:
            s, r, t = refit

    if not math.isfinite(s) or s <= 0:
        return None
    return s, r, t


def _umeyama(source: np.ndarray, target: np.ndarray) -> tuple[float, np.ndarray, np.ndarray] | None:
    mu_s = source.mean(axis=0)
    mu_t = target.mean(axis=0)
    xs = source - mu_s
    xt = target - mu_t
    variance = float((xs ** 2).sum() / len(source))
    if variance < 1e-12:
        return None
    covariance = xt.T @ xs / len(source)
    u, d, vt = np.linalg.svd(covariance)
    sign = np.ones(3)
    # Зеркалить нельзя: отражённый предмет — это другой предмет.
    if np.linalg.det(u @ vt) < 0:
        sign[2] = -1
    r = u @ np.diag(sign) @ vt
    s = float((d * sign).sum() / variance)
    t = mu_t - s * (r @ mu_s)
    return s, r, t


def metric_scale(ar_positions: dict[str, list[float]],
                 colmap_centers: dict[str, tuple[float, float, float]]) -> float | None:
    """Метров на одну единицу COLMAP, либо None, если доверять нечему.

    Медиана попарных отношений, а не среднее: у COLMAP бывают одиночные грубо промахнувшиеся
    позы, и одно такое отношение не должно тащить за собой размер всего предмета.
    """
    names = sorted(set(ar_positions) & set(colmap_centers))
    if len(names) < MIN_MATCHED:
        return None

    # На полном куполе пар немного и берём все; на длинной съёмке — прореживаем шагами,
    # чтобы не считать сотню тысяч корней ради той же медианы.
    if len(names) <= 60:
        pairs = [(i, j) for i in range(len(names)) for j in range(i + 1, len(names))]
    else:
        strides = (1, 3, 7, 15, 31)
        pairs = [(i, i + k) for k in strides for i in range(len(names) - k)]

    ratios: list[float] = []
    for i, j in pairs:
        a = ar_positions[names[i]]
        b = ar_positions[names[j]]
        ar_dist = math.dist((a[0], a[1], a[2]), (b[0], b[1], b[2]))
        if ar_dist < MIN_AR_BASELINE_M:
            continue
        colmap_dist = math.dist(colmap_centers[names[i]], colmap_centers[names[j]])
        if colmap_dist < 1e-9:
            continue
        ratios.append(ar_dist / colmap_dist)

    if len(ratios) < MIN_RATIOS:
        return None
    ratios.sort()
    return ratios[len(ratios) // 2]
