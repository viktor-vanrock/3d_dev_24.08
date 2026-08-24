import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeMoonraker, type FakeMoonraker } from "../../testing/fakeMoonraker.ts";
import { MoonrakerDriver } from "./moonrakerDriver.ts";

describe("MoonrakerDriver", () => {
  let fake: FakeMoonraker;
  let driver: MoonrakerDriver;

  afterEach(async () => {
    await driver?.disconnect();
    await fake?.close();
  });

  describe("без авторизации (trusted LAN, apiKey не задан)", () => {
    beforeEach(async () => {
      fake = await startFakeMoonraker({ webcams: [{ stream_url: "/webcam/stream" }] });
      driver = new MoonrakerDriver({ httpUrl: fake.url });
      await driver.connect();
    });

    it("подключается и читает capabilities через PrinterDriver", async () => {
      const caps = await driver.capabilities();
      expect(caps.heatedBed).toBe(true);
      expect(caps.multiExtruder).toBe(false);
      expect(caps.camera).toBe(true);
      expect(caps.supportedCommands).toEqual(["pause", "resume", "cancel", "start"]);
    });

    it("читает статус через PrinterDriver", async () => {
      fake.setPrintStats({ state: "printing", filename: "benchy.gcode" });
      const status = await driver.status();
      expect(status.status).toBe("printing");
      expect(status.jobFileName).toBe("benchy.gcode");
      expect(status.nozzleTempC).toBe(210.4);
      expect(status.bedTempC).toBe(60.1);
    });

    it.each(["complete", "cancelled", "standby", "error"])(
      "не публикует сохранённый прогресс для состояния %s",
      async (state) => {
        fake.setPrintStats({ state, filename: "benchy.gcode", progress: 1 });

        const status = await driver.status();

        expect(status.progress).toBeNull();
      },
    );

    it("pause/resume/cancel доходят до Moonraker и возвращают ok", async () => {
      expect((await driver.pause()).ok).toBe(true);
      expect((await driver.resume()).ok).toBe(true);
      expect((await driver.cancel()).ok).toBe(true);
      expect(fake.printCommandCalls).toEqual({ pause: 1, resume: 1, cancel: 1, start: [] });
    });

    it("startPrint запускает job выбранного файла", async () => {
      const result = await driver.startPrint("benchy.gcode");
      expect(result.ok).toBe(true);
      expect(fake.printCommandCalls.start).toEqual(["benchy.gcode"]);
    });

    it("uploadGcode кладёт файл на принтер и возвращает storedAs", async () => {
      const data = new TextEncoder().encode("G28\nG1 X10\n");
      const result = await driver.uploadGcode({ fileName: "part.gcode", data });
      expect(result.ok).toBe(true);
      expect(result.storedAs).toBe("gcodes/part.gcode");
      expect(fake.uploadedFiles.get("part.gcode")?.toString("utf8")).toBe("G28\nG1 X10\n");
    });

    it("uploadGcodeStream передаёт чанки без сборки полного буфера", async () => {
      const chunks = [new TextEncoder().encode("G28\n"), new TextEncoder().encode("G1 X10\n")];
      const result = await driver.uploadGcodeStream!({
        fileName: "streamed.gcode",
        size: chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
        data: (async function* () {
          for (const chunk of chunks) yield chunk;
        })(),
      });

      expect(result).toMatchObject({ ok: true, storedAs: "gcodes/streamed.gcode" });
      expect(fake.uploadedFiles.get("streamed.gcode")?.toString("utf8")).toBe("G28\nG1 X10\n");
    });

    it("reconciles a remote upload from its actual bytes", async () => {
      const data = new TextEncoder().encode("G28\nG1 X10\n");
      await driver.uploadGcode({ fileName: "reconcile.gcode", data });

      await expect(driver.inspectFile({ root: "gcodes", fileName: "reconcile.gcode" })).resolves.toEqual({
        status: "present",
        storedAs: "gcodes/reconcile.gcode",
        sizeBytes: data.byteLength,
        sha256: createHash("sha256").update(data).digest("hex"),
      });
      await expect(driver.inspectFile({ root: "gcodes", fileName: "missing.gcode" })).resolves.toEqual({ status: "absent" });
    });

    it("возвращает CameraInfo, когда у Moonraker сконфигурирован вебкам", async () => {
      const camera = await driver.camera();
      expect(camera?.streamUrl).toBe(`${fake.url}/webcam/stream`);
    });

    it("отдаёт push-обновления статуса через onStatusUpdate без polling", async () => {
      const seen: string[] = [];
      const unsubscribe = driver.onStatusUpdate((snapshot) => seen.push(snapshot.status));

      fake.pushStatusUpdate({ print_stats: { state: "paused", filename: "x.gcode" } });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(seen).toEqual(["paused"]);
      unsubscribe();
    });
  });

  describe("с авторизацией (oneshot-token в query-string)", () => {
    beforeEach(async () => {
      fake = await startFakeMoonraker({ apiKey: "secret-key" });
    });

    it("успешно коннектится с верным apiKey через oneshot-token хендшейк", async () => {
      driver = new MoonrakerDriver({ httpUrl: fake.url, apiKey: "secret-key" });
      await expect(driver.connect()).resolves.toBeUndefined();
    });

    it("не подключается без ключа — WS отказывает без валидного oneshot-токена", async () => {
      driver = new MoonrakerDriver({ httpUrl: fake.url });
      await expect(driver.connect()).rejects.toThrow();
    });

    it("неверный ключ возвращает HTTP 401, не посылает команду печати и допускает read-only recovery", async () => {
      driver = new MoonrakerDriver({ httpUrl: fake.url, apiKey: "wrong-key" });

      await expect(driver.connect()).rejects.toThrow("moonraker oneshot_token -> HTTP 401");
      expect(await driver.pause()).toMatchObject({ ok: false });
      expect(fake.printCommandCalls).toEqual({ pause: 0, resume: 0, cancel: 0, start: [] });

      await driver.disconnect();
      driver = new MoonrakerDriver({ httpUrl: fake.url, apiKey: "secret-key" });
      await driver.connect();
      await expect(driver.status()).resolves.toMatchObject({ status: "idle" });
      expect(fake.printCommandCalls).toEqual({ pause: 0, resume: 0, cancel: 0, start: [] });
    });
  });

  it("недоступный endpoint прекращает опасную команду до Moonraker", async () => {
    // Отдельный двойник нужен только как evidence: вызовы к нему должны остаться нулевыми.
    fake = await startFakeMoonraker();
    driver = new MoonrakerDriver({ httpUrl: "http://127.0.0.1:1" });

    await expect(driver.connect()).rejects.toThrow("ECONNREFUSED");
    await expect(driver.cancel()).resolves.toMatchObject({ ok: false });
    expect(fake.printCommandCalls).toEqual({ pause: 0, resume: 0, cancel: 0, start: [] });
  });
});
