import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindingLabel, connectionEvidence, fetchPrinterBasics, httpPrinterLiveSource, safeCredentialRejection, type LiveState } from "./livesource.ts";

describe("safeCredentialRejection", () => {
  it("маппит только три безопасные причины и не раскрывает произвольный ответ", () => {
    expect(safeCredentialRejection("invalid_token")).toBe("invalid_token");
    expect(safeCredentialRejection("unknown_agent")).toBe("unknown_agent");
    expect(safeCredentialRejection("revoked")).toBe("revoked");
    expect(safeCredentialRejection("Bearer secret")).toBeNull();
    expect(safeCredentialRejection({ code: "revoked" })).toBeNull();
  });
});

describe("bindingLabel", () => {
  it("подписывает известные link_source честными строками (§1.3 printer.face.md)", () => {
    expect(bindingLabel("agent")).toBe("Через наш агент");
    expect(bindingLabel("ip")).toBe("Локально, в вашей сети");
    expect(bindingLabel("manual")).toBe("Просто отмечен в парке");
  });

  it("не выдумывает уровень для незнакомого link_source", () => {
    expect(bindingLabel("mystery")).toBe("Привязка неизвестна");
  });
});

describe("fetchPrinterBasics", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("находит принтер по id в списке /me/printers", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ printers: [{ id: "p1", brand: "Prusa", model: "MK4", link_source: "agent" }] }),
    });
    const result = await fetchPrinterBasics("p1");
    expect(result).toEqual({ id: "p1", brand: "Prusa", model: "MK4", linkSource: "agent", lanEndpoint: null, firmwareReady: null });
  });

  it("возвращает null, когда id не найден в парке", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ printers: [] }) });
    expect(await fetchPrinterBasics("missing")).toBeNull();
  });

  it("не бросает при сетевой ошибке — возвращает null (тот же приём, что enroll.ts)", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await fetchPrinterBasics("p1")).toBeNull();
  });
});

describe("httpPrinterLiveSource", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("эндпоинт ещё не существует (404) — live:false, не выдуманные метрики", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const source = httpPrinterLiveSource();
    let snapshot: LiveState | undefined;
    const unsubscribe = source.subscribe("p1", (state) => {
      snapshot = state;
    });
    await vi.waitFor(() => expect(snapshot).toBeDefined());
    expect(snapshot).toMatchObject({ phase: "offline", live: false });
    unsubscribe();
  });

  it("сохраняет только безопасную причину отказа и не принимает сырой текст", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "revoked" }) });
    const source = httpPrinterLiveSource();
    let snapshot: LiveState | undefined;
    const unsubscribe = source.subscribe("p1", (state) => { snapshot = state; });
    await vi.waitFor(() => expect(snapshot).toBeDefined());
    expect(snapshot).toMatchObject({ live: false, rejection: "revoked" });
    expect(JSON.stringify(snapshot)).not.toContain("Bearer");
    unsubscribe();
  });

  it("помечает последний кадр устаревшим, сохраняя его снимок при отказе", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: "ready", metrics: { nozzleTempC: 210 }, state_updated_at: "2026-07-13T00:00:00Z" }),
    }).mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "invalid_token" }) });
    const source = httpPrinterLiveSource();
    const snapshots: LiveState[] = [];
    const unsubscribe = source.subscribe("p1", (state) => snapshots.push(state));
    await vi.waitFor(() => expect(snapshots).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(snapshots).toHaveLength(2));
    expect(snapshots[1]).toMatchObject({ live: false, rejection: "invalid_token", nozzle: { value: 210 }, updatedAt: "2026-07-13T00:00:00Z" });
    unsubscribe();
  });

  it("MF-1500 online→offline→online сохраняет stale-снимок и очищает его свежим кадром", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: "ready", metrics: { nozzleTempC: 210 }, state_updated_at: "2026-07-13T00:00:00Z" }),
      })
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: "printing", progress: 12, metrics: { nozzleTempC: 215 }, state_updated_at: "2026-07-13T00:00:04Z" }),
      });

    const source = httpPrinterLiveSource();
    const snapshots: LiveState[] = [];
    const unsubscribe = source.subscribe("p1", (state) => snapshots.push(state));

    await vi.waitFor(() => expect(snapshots).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(snapshots).toHaveLength(2));
    expect(snapshots[1]).toMatchObject({ phase: "offline", live: false, nozzle: { value: 210 }, updatedAt: "2026-07-13T00:00:00Z" });

    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(snapshots).toHaveLength(3));
    expect(snapshots[2]).toMatchObject({ phase: "printing", live: true, progress: 12, nozzle: { value: 215 }, updatedAt: "2026-07-13T00:00:04Z" });
    unsubscribe();
  });

  it("кадр с device_state — раскладывает metrics.nozzleTempC/bedTempC по контракту device-agent (main.ts)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "printing",
        progress: 42,
        metrics: { nozzleTempC: 215, bedTempC: 60 },
        job_id: "job1",
        state_updated_at: "2026-07-11T12:00:00Z",
      }),
    });
    const source = httpPrinterLiveSource();
    let snapshot: LiveState | undefined;
    const unsubscribe = source.subscribe("p1", (state) => {
      snapshot = state;
    });
    await vi.waitFor(() => expect(snapshot).toBeDefined());
    expect(snapshot).toMatchObject({
      phase: "printing",
      progress: 42,
      nozzle: { value: 215, tone: "ok" },
      bed: { value: 60, tone: "ok" },
      live: true,
    });
    unsubscribe();
  });

  it("сохраняет причину stale и last_confirmed_at, не выдавая старый HTTP-ответ за свежий кадр", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "printing",
        progress: 42,
        metrics: { nozzleTempC: 210 },
        state_updated_at: "2026-07-15T10:00:00.000Z",
        last_confirmed_at: "2026-07-15T10:00:00.000Z",
        live_availability_reason: "stale",
        connection_mode: "managed-bridge",
      }),
    });
    const snapshots: LiveState[] = [];
    const unsubscribe = httpPrinterLiveSource().subscribe("p1", (state) => snapshots.push(state));

    await vi.waitFor(() => expect(snapshots).toHaveLength(1));
    expect(snapshots[0]).toMatchObject({
      phase: "printing",
      availabilityReason: "stale",
      lastConfirmedAt: "2026-07-15T10:00:00.000Z",
      connectionMode: "managed-bridge",
    });
    unsubscribe();
  });
});

describe("connectionEvidence", () => {
  const offline: LiveState = { phase: "offline", progress: null, nozzle: null, bed: null, chamber: null, jobId: null, updatedAt: null, live: false };

  it("не показывает готовность без firmware/API evidence", () => {
    const evidence = connectionEvidence({ firmwareReady: null, linkSource: "agent" }, offline, false);
    expect(evidence.firmware).toEqual({ label: "Не подтверждена", tone: "dim" });
    expect(evidence.relay.label).toBe("Нет подтверждения");
    expect(evidence.recovery.label).toBe("Ожидание подключения");
  });

  it("показывает ready-путь только для живого кадра и отмечает recovery после сбоя", () => {
    const live: LiveState = { ...offline, phase: "ready", live: true };
    expect(connectionEvidence({ firmwareReady: true, linkSource: "agent" }, live, false)).toMatchObject({
      firmware: { label: "Подтверждена" }, relay: { label: "На связи" }, moonraker: { label: "Доступен" }, recovery: { label: "Стабильно" },
    });
    expect(connectionEvidence({ firmwareReady: null, linkSource: "agent" }, offline, true).recovery).toEqual({ label: "Восстанавливаем связь", tone: "warn" });
  });

  it("не выдаёт managed-local за удалённый relay-канал", () => {
    const local: LiveState = { ...offline, phase: "ready", live: true, connectionMode: "managed-local", availabilityReason: "available" };
    expect(connectionEvidence({ firmwareReady: null, linkSource: "ip" }, local, false)).toMatchObject({
      relay: { label: "Не используется локально", tone: "dim" },
      moonraker: { label: "Доступен локально", tone: "ok" },
    });
  });
});
