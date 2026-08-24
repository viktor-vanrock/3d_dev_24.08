// Dev-мок API для UI-работы без бэкенда: `VITE_MOCK=1 pnpm dev` (только DEV-сборка,
// в прод-бандл не попадает — main.tsx импортирует его динамически под import.meta.env.DEV).
// Состояние живёт в памяти вкладки; ?mock_state=first_run|returning выбирает ветку дома.

interface MockActivation {
  state: string;
  has_printer: boolean;
  primary_persona: string | null;
  persona_source: string | null;
  home_tier: string;
  activation_checklist: Record<string, boolean>;
  home_dismissed_prompts: Record<string, boolean>;
}

export function installMockApi(): void {
  const params = new URLSearchParams(window.location.search);
  const activation: MockActivation = {
    state: params.get("mock_state") ?? "returning",
    has_printer: false,
    primary_persona: null,
    persona_source: null,
    home_tier: (params.get("mock_tier") as string) ?? "auto",
    activation_checklist: {},
    home_dismissed_prompts: {},
  };
  const printers: unknown[] = [];

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

    if (url.includes("/auth/session")) return json({ user: { id: "mock", username: "maker" } });
    if (url.includes("/auth/logout")) return json({ ok: true });
    if (url.includes("/consent")) return json({ ok: true }, 201);
    // Проверяем ДО общего /me/activation ниже — иначе более специфичный путь событий
    // (Фаза 3, MF-438) ловится общей веткой и отдаёт не тот ответ.
    if (url.includes("/me/activation/events")) return json({ ok: true }, 202);
    if (url.includes("/models")) return json({ models: [], has_more: false, next_cursor: null });
    if (url.includes("/me/activation")) {
      if (init?.method === "PATCH") {
        Object.assign(activation, JSON.parse(String(init.body ?? "{}")));
        if ((JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>).first_run_completed) {
          activation.state = "returning";
        }
        return json({ activation });
      }
      return json({ activation, printers });
    }
    if (url.includes("/me/printers")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const printer = { id: `p${printers.length + 1}`, is_primary: !printers.length, verified: true, ...body };
      printers.push(printer);
      activation.has_printer = true;
      return json({ printer }, 201);
    }
    return realFetch(input, init);
  };
}
