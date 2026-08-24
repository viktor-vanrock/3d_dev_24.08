// Enroll-код (managed-bridge/custom, printer.wizard.md §4) — тонкая обёртка над РЕАЛЬНЫМ
// эндпоинтом `POST /me/devices/enroll-codes` (apps/api/src/devices/enroll.route.ts, MF-795/MF-26,
// уже смержено), не мок. TTL 15 минут — совпадает с текстом «код истёк» в UI (§4).

import { apiFetch } from "@shared/api";
import type { components } from "src/api/generated/openapi";

export interface EnrollCode {
  code: string;
  expiresAt: string;
  installCommand: string;
}

export async function createEnrollCode(): Promise<EnrollCode | null> {
  try {
    const response = await apiFetch(`/me/devices/enroll-codes`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as components["schemas"]["DeviceEnrollCodeDto"];
    return { code: data.code, expiresAt: data.expires_at, installCommand: data.install_command };
  } catch {
    return null;
  }
}

// Редимпшн кода делает АГЕНТ на чужом железе (POST /devices/agent/enroll), не браузер — здесь
// сегодня нет ручки «статус кода» (нашли при разборе enroll.ts/enroll.route.ts), поэтому ждём
// появления принтера в парке тем же способом, что уже читает useActivation (GET /me/activation):
// опрашиваем и сравниваем список id с тем, что было до создания кода. Как только Back заведёт
// прямой статус-эндпоинт под код — можно заменить поллинг на него без изменения контракта экрана.
export type PrinterIdsResult = { ids: string[]; online: boolean };

export async function fetchPrinterIds(): Promise<PrinterIdsResult> {
  try {
    const response = await apiFetch(`/me/activation`, { credentials: "include" });
    if (!response.ok) return { ids: [], online: false };
    const data = (await response.json()) as components["schemas"]["ActivationResponseDto"];
    return { ids: (data.printers ?? []).map((printer) => printer.id), online: true };
  } catch {
    return { ids: [], online: false };
  }
}