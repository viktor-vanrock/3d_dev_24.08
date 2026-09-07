import { useEffect, useState } from "react";
import { apiFetch } from "@shared/api";
import { getCookie } from "@shared/lib/cookie.ts";

export function useDevMode(): boolean {
  const [isDevMode, setIsDevMode] = useState(() => getCookie("is_dev") === "true");

  useEffect(() => {
    if (isDevMode) return;
    let cancelled = false;
    void apiFetch("/auth/dev/available", { credentials: "include" })
      .then(async (response) => (response.ok ? (await response.json()) as { available?: unknown } : null))
      .then((data) => {
        if (!cancelled && data?.available === true) setIsDevMode(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isDevMode]);

  return isDevMode;
}
