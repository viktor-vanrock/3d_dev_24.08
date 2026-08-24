"""Диагностика non-manifold геометрии перед упаковкой (MF-379, Фаза 2).

`strict` — только это, без правки геометрии; `repair` (`mesh.convert`) чинит
и сравнивает отчёт до/после, чтобы залогировать, что изменилось. Никакой
scipy — воркер apps/mesh намеренно его не тянет (см. `mesh.convert`
docstring): число оболочек считаем через `Trimesh.split(only_watertight=
False)` (бэкенд networkx, не scipy), число дыр — вручную группировкой
граничных рёбер (ровно один смежный треугольник) в замкнутые контуры через
union-find.

Проверки на копии меша (`is_winding_consistent`-проба, `split`) — той же
стоимости, что и сама починка, поэтому бюджет `Limits.max_repair_triangles`
из `mesh.limits` ограничивает и их: на мешах дороже бюджета `shell_count`/
`winding_flipped_face_indices` пропускаются (`None`) — самая частая причина,
почему diagnose() не гарантирует все поля.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import trimesh


@dataclass(frozen=True)
class MeshDiagnostics:
    """Отчёт по одной детали. Индексы граней — в нумерации той версии меша,
    на которой посчитан отчёт (см. вызывающий код: до или после починки)."""

    watertight: bool
    winding_consistent: bool
    degenerate_face_indices: tuple[int, ...]
    duplicate_face_indices: tuple[int, ...]
    hole_count: int
    # None = пропущено по бюджету (мешь дороже Limits.max_repair_triangles).
    shell_count: int | None
    winding_flipped_face_indices: tuple[int, ...] | None

    @property
    def is_clean(self) -> bool:
        return (
            self.watertight
            and self.winding_consistent
            and not self.degenerate_face_indices
            and not self.duplicate_face_indices
        )

    def to_dict(self) -> dict:
        return {
            "watertight": self.watertight,
            "winding_consistent": self.winding_consistent,
            "degenerate_face_count": len(self.degenerate_face_indices),
            "degenerate_face_indices": list(self.degenerate_face_indices),
            "duplicate_face_count": len(self.duplicate_face_indices),
            "duplicate_face_indices": list(self.duplicate_face_indices),
            "hole_count": self.hole_count,
            "shell_count": self.shell_count,
            "winding_flipped_face_count": (
                None
                if self.winding_flipped_face_indices is None
                else len(self.winding_flipped_face_indices)
            ),
            "winding_flipped_face_indices": (
                None
                if self.winding_flipped_face_indices is None
                else list(self.winding_flipped_face_indices)
            ),
        }


def _hole_loop_count(mesh: trimesh.Trimesh) -> int:
    """Число замкнутых контуров граничных рёбер — прокси для «числа дыр».

    Ребро на границе дыры (или открытого края) встречается ровно у одного
    треугольника; рёбра внутри watertight-поверхности — ровно у двух.
    Группируем граничные рёбра по связности вершин (union-find) — каждая
    компонента связности этого подграфа — один контур/одна дыра.
    """
    if mesh.is_watertight or len(mesh.faces) == 0:
        return 0
    edges_sorted = np.asarray(mesh.edges_sorted)
    if len(edges_sorted) == 0:
        return 0

    view_dtype = np.dtype((np.void, edges_sorted.dtype.itemsize * 2))
    flat = np.ascontiguousarray(edges_sorted).view(view_dtype).reshape(-1)
    _, inverse, counts = np.unique(flat, return_inverse=True, return_counts=True)
    boundary_edges = edges_sorted[counts[inverse] == 1]
    if len(boundary_edges) == 0:
        return 0

    parent: dict[int, int] = {}

    def find(x: int) -> int:
        root = x
        while parent.get(root, root) != root:
            root = parent[root]
        while parent.get(x, x) != root:
            parent[x], x = root, parent.get(x, root)
        return root

    for a, b in boundary_edges:
        ra, rb = find(int(a)), find(int(b))
        if ra != rb:
            parent[ra] = rb

    roots = {find(int(v)) for edge in boundary_edges for v in edge}
    return len(roots)


def _winding_flip_indices(mesh: trimesh.Trimesh) -> tuple[int, ...]:
    """Грани, которые перевернёт `trimesh.repair.fix_winding` — прокси для
    «разрыва намотки/инверсной нормали» на конкретной грани. Считаем на
    копии, чтобы не мутировать вход."""
    if mesh.is_winding_consistent or len(mesh.faces) == 0:
        return ()
    probe = mesh.copy()
    trimesh.repair.fix_winding(probe)
    if probe.faces.shape != mesh.faces.shape:
        return ()  # copy() расщепила геометрию иначе — редкий случай, отчёт пропускаем
    changed = np.any(probe.faces != mesh.faces, axis=1)
    return tuple(int(i) for i in np.where(changed)[0])


def diagnose(mesh: trimesh.Trimesh, *, budget_triangles: int | None = None) -> MeshDiagnostics:
    """Считает отчёт о состоянии меша, не изменяя его.

    `budget_triangles` — потолок для дорогих проверок (`split`/winding-проба);
    выше него `shell_count`/`winding_flipped_face_indices` пропускаются
    (`None`), но дешёвые поля (watertight/degenerate/duplicate/hole_count)
    считаются всегда — они векторные O(n) без копий меша.
    """
    degenerate = tuple(int(i) for i in np.where(~mesh.nondegenerate_faces())[0])
    duplicate = tuple(int(i) for i in np.where(~mesh.unique_faces())[0])
    within_budget = budget_triangles is None or len(mesh.faces) <= budget_triangles

    winding_flips: tuple[int, ...] | None = None
    shell_count: int | None = None
    if within_budget:
        winding_flips = _winding_flip_indices(mesh)
        try:
            shell_count = len(mesh.split(only_watertight=False))
        except Exception:  # noqa: BLE001 — диагностика best-effort, не должна валить конвертацию
            shell_count = 1 if len(mesh.faces) else 0

    return MeshDiagnostics(
        watertight=bool(mesh.is_watertight),
        winding_consistent=bool(mesh.is_winding_consistent),
        degenerate_face_indices=degenerate,
        duplicate_face_indices=duplicate,
        hole_count=_hole_loop_count(mesh),
        shell_count=shell_count,
        winding_flipped_face_indices=winding_flips,
    )
