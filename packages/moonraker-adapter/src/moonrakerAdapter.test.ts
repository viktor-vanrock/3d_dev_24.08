import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeMoonraker, type FakeMoonraker } from "./testing/fakeMoonraker.ts";
import { MoonrakerAdapter } from "./moonrakerAdapter.ts";

describe("MoonrakerAdapter", () => {
  let fake: FakeMoonraker;
  let adapter: MoonrakerAdapter;

  afterEach(async () => {
    await adapter?.disconnect();
    await fake?.close();
  });

  describe("без авторизации (trusted LAN, apiKey не задан)", () => {
    beforeEach(async () => {
      fake = await startFakeMoonraker({ webcams: [{ stream_url: "/webcam/stream" }] });
      adapter = new MoonrakerAdapter({ httpUrl: fake.url });
      await adapter.connect();
    });

    it("объявляет connectorType", () => {
      expect(adapter.connectorType).toBe("moonraker");
    });

    it("читает capabilities через PrinterDriver", async () => {
      const caps = await adapter.capabilities();
      expect(caps.heatedBed).toBe(true);
      expect(caps.camera).toBe(true);
    });

    it("читает состояние через getState", async () => {
      fake.setPrintStats({ state: "printing", filename: "benchy.gcode" });
      const state = await adapter.getState();
      expect(state.state).toBe("printing");
      expect(state.jobFileName).toBe("benchy.gcode");
      expect(state.nozzleTempC).toBe(210.4);
      expect(state.bedTempC).toBe(60.1);
    });

    it("pause/stop доходят до Moonraker и возвращают ok", async () => {
      expect((await adapter.pause()).ok).toBe(true);
      expect((await adapter.stop()).ok).toBe(true);
      expect(fake.printCommandCalls).toEqual({ pause: 1, resume: 0, cancel: 1, start: [] });
    });

    it("start(fileName) запускает job выбранного файла", async () => {
      const result = await adapter.start("benchy.gcode");
      expect(result.ok).toBe(true);
      expect(fake.printCommandCalls.start).toEqual(["benchy.gcode"]);
    });

    it("start() без имени резюмирует приостановленную печать, не printer.print.start", async () => {
      const result = await adapter.start();
      expect(result.ok).toBe(true);
      expect(fake.printCommandCalls.resume).toBe(1);
      expect(fake.printCommandCalls.start).toEqual([]);
    });

    it("запрещает произвольный G-code в v1 и не обращается к Moonraker", async () => {
      const result = await adapter.sendGcode("G28\nG1 X10");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("forbidden");
      expect(fake.gcodeScripts).toEqual([]);
    });

    it("uploadFile кладёт файл на принтер и возвращает storedAs", async () => {
      const data = new TextEncoder().encode("G28\nG1 X10\n");
      const result = await adapter.uploadFile({ fileName: "part.gcode", data });
      expect(result.ok).toBe(true);
      expect(result.storedAs).toBe("gcodes/part.gcode");
      expect(fake.uploadedFiles.get("part.gcode")?.toString("utf8")).toBe("G28\nG1 X10\n");
    });

    it("возвращает CameraStream, когда у Moonraker сконфигурирован вебкам", async () => {
      const camera = await adapter.camera();
      expect(camera?.streamUrl).toBe(`${fake.url}/webcam/stream`);
    });

    it("null, когда вебкам не сконфигурирован", async () => {
      await adapter.disconnect();
      fake = await startFakeMoonraker();
      adapter = new MoonrakerAdapter({ httpUrl: fake.url });
      await adapter.connect();
      expect(await adapter.camera()).toBeNull();
    });

    it("отдаёт push-обновления телеметрии через subscribeTelemetry без polling", async () => {
      const seen: string[] = [];
      const unsubscribe = adapter.subscribeTelemetry((snapshot) => seen.push(snapshot.state));

      fake.pushStatusUpdate({ print_stats: { state: "paused", filename: "x.gcode" } });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(seen).toEqual(["paused"]);
      unsubscribe();
    });

    it("команда после disconnect возвращает {ok:false, error} вместо исключения", async () => {
      await adapter.disconnect();
      const result = await adapter.pause();
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe("с авторизацией (oneshot-token в query-string)", () => {
    beforeEach(async () => {
      fake = await startFakeMoonraker({ apiKey: "secret-key" });
    });

    it("подключается по oneshot-token, полученному через X-Api-Key", async () => {
      adapter = new MoonrakerAdapter({ httpUrl: fake.url, apiKey: "secret-key" });
      await adapter.connect();
      const caps = await adapter.capabilities();
      expect(caps.raw.objects).toBeDefined();
    });

    it("не подключается без ключа, если Moonraker требует авторизацию", async () => {
      adapter = new MoonrakerAdapter({ httpUrl: fake.url });
      await expect(adapter.connect()).rejects.toThrow();
    });

    it("uploadFile отправляет X-Api-Key", async () => {
      adapter = new MoonrakerAdapter({ httpUrl: fake.url, apiKey: "secret-key" });
      await adapter.connect();
      const result = await adapter.uploadFile({ fileName: "a.gcode", data: new Uint8Array([1, 2, 3]) });
      expect(result.ok).toBe(true);
    });
  });
});
