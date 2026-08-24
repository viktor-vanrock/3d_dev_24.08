import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkMoonrakerIp } from "./ipcheck.ts";
import { fetchPrinterBasics, httpPrinterLiveSource, loopbackHelperUrl, type LiveState } from "./livesource.ts";

/**
 * MF-1223: контракт браузерной регрессии managed-local.
 *
 * Это намеренно transport-level тест UI-контура: fixture имитируется ответом
 * Moonraker, а журнал запросов позволяет отличить browser→LAN от API/relay→LAN.
 */
describe("managed-local browser regression (MF-1223)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => vi.stubGlobal("fetch", fetchMock));

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("проходит Moonraker fixture напрямую из браузерного transport-а", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ result: { state: "ready", klipper_path: "/tmp/klippy.sock" } }),
    });

    expect(await checkMoonrakerIp("192.168.1.42")).toEqual({ status: "ok", endpoint: "192.168.1.42:7125" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://192.168.1.42:7125/printer/info",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    "https://127.0.0.1/redirect",
    "localhost",
    "printer.local",
    "8.8.8.8",
    "169.254.169.254",
    "http://192.168.1.42",
    "[2001:4860:4860::8888]",
    "[c000::1]",
    "[f000::1]",
    "[fd00:::42]",
    "[::1]",
  ])("отклоняет SSRF payload %s до сетевого запроса", async (payload) => {
      await expect(checkMoonrakerIp(payload)).resolves.toEqual({ status: "error" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

  it("поддерживает IPv6 ULA как буквальный LAN endpoint, но блокирует loopback", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: { state: "ready" } }) });
    await expect(checkMoonrakerIp("127.0.0.1")).resolves.toEqual({ status: "error" });
    await expect(checkMoonrakerIp("[fd00::42]")).resolves.toEqual({ status: "ok", endpoint: "[fd00::42]:7125" });
    expect(fetchMock).toHaveBeenCalledWith("http://[fd00::42]:7125/printer/info", expect.any(Object));
  });

  it.each(["10.0.0.7", "172.16.0.7", "172.31.255.250", "192.168.0.7"]) (
    "разрешает частный IPv4 LAN endpoint %s",
    async (payload) => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: { state: "ready" } }) });

      await expect(checkMoonrakerIp(payload)).resolves.toEqual({ status: "ok", endpoint: `${payload}:7125` });
      expect(fetchMock).toHaveBeenCalledWith(`http://${payload}:7125/printer/info`, expect.any(Object));
    },
  );

  it("показывает live state из loopback-helper fixture и не отправляет LAN-запрос через API", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === loopbackHelperUrl("192.168.1.42:7125")) {
        return { ok: true, json: async () => ({ result: { state: "ready" } }) };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const snapshots: LiveState[] = [];
    const stop = httpPrinterLiveSource().subscribe("owned-printer", (state) => snapshots.push(state), "192.168.1.42:7125");
    await vi.waitFor(() => expect(snapshots).toHaveLength(1));
    stop();

    expect(snapshots[0]).toMatchObject({ phase: "ready", live: true, connectionMode: "managed-local" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(loopbackHelperUrl("192.168.1.42:7125"));
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("http://192.168.1.42"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/me/") || String(url).includes("/relay"))).toBe(false);
  });

  it("MF-1843: помечает helper unavailable, когда соединение к loopback не устанавливается ДО ответа", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));

    const snapshots: LiveState[] = [];
    const stop = httpPrinterLiveSource().subscribe("owned-printer", (state) => snapshots.push(state), "192.168.1.42:7125");
    await vi.waitFor(() => expect(snapshots).toHaveLength(1));
    stop();

    expect(snapshots[0]).toMatchObject({ phase: "offline", live: false, availabilityReason: "helper_unavailable", connectionMode: "managed-local" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(loopbackHelperUrl("192.168.1.42:7125"));
  });

  it("MF-1843: helper ответил своей ошибкой LAN-пробы — остаётся offline/direct-error, не helper unavailable", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === loopbackHelperUrl("192.168.1.42:7125")) return { ok: false, status: 503, json: async () => ({}) };
      throw new Error(`unexpected request: ${url}`);
    });

    const snapshots: LiveState[] = [];
    const stop = httpPrinterLiveSource().subscribe("owned-printer", (state) => snapshots.push(state), "192.168.1.42:7125");
    await vi.waitFor(() => expect(snapshots).toHaveLength(1));
    stop();

    expect(snapshots[0]).toMatchObject({ phase: "offline", live: false, availabilityReason: "server_error" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/me/") || String(url).includes("/relay"))).toBe(false);
  });

  it.each(["192.168.1", "192.168.1.256", "[fd00::gg]"])("отклоняет неполный или некорректный IP %s до сетевого запроса", async (payload) => {
    await expect(checkMoonrakerIp(payload)).resolves.toEqual({ status: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("берёт printer basics только из owner-scoped /me/printers ответа", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ printers: [{ id: "owned-printer", brand: "Creality", model: "Ender-3 V3 KE", link_source: "ip", lan_endpoint: "192.168.1.42:7125" }] }),
    });

    await expect(fetchPrinterBasics("other-users-printer")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/me/printers", { credentials: "include" });
  });
});
