"""Детерминированный базовый профиль (MF-412-эквивалент) для AI-слоя (MF-1941).

`compute_baseline` — документированный порт `recommendProfileForIds` из
`apps/api/src/slicerProfiles/recommendation.ts`: та же выборка строк, тот же
резолвер (`matcher_port.recommend_profile`). AI-дельты (`delta.py`) строятся
ПОВЕРХ этого результата, не вместо него — тот же принцип, что у `matcher.ts`
самого MF-412 (базовый профиль + оверлей материала/intent).
"""

from __future__ import annotations

from dataclasses import dataclass

import psycopg

from . import db
from .matcher_port import (
    FilamentInput,
    NoMatchingProfileError,
    PrinterInput,
    ProfileIntent,
    Recommendation,
    recommend_profile,
)


@dataclass(frozen=True)
class BaselineContext:
    printer: PrinterInput
    filament: FilamentInput
    recommendation: Recommendation


def compute_baseline(
    conn: psycopg.Connection, printer_id: str, filament_id: str, intent: ProfileIntent
) -> BaselineContext:
    printer = db.fetch_printer(conn, printer_id)
    filament = db.fetch_filament(conn, filament_id)
    if printer is None or filament is None:
        raise NoMatchingProfileError()

    profiles = db.fetch_active_profiles(conn)
    base_profiles = [p for p in profiles if p.profile_class != "filament"]
    filament_profiles = [p for p in profiles if p.profile_class == "filament"]
    recommendation = recommend_profile(printer, filament, base_profiles, filament_profiles, intent)
    return BaselineContext(printer=printer, filament=filament, recommendation=recommendation)
