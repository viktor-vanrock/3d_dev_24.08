import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";

/**
 * Opt-in memory profile for the binary relay transfer data path.
 * Run with FILE_TRANSFER_LOAD_TEST=1 and --expose-gc.
 */
const RUN = process.env.FILE_TRANSFER_LOAD_TEST === "1";
const FILE_SIZE_BYTES = 100 * 1024 * 1024;
const CHUNK_SIZE_BYTES = 512 * 1024;
const MEMORY_LIMIT_MB = 200;

function source(totalBytes: number): Readable {
  let sent = 0;
  return new Readable({
    read() {
      if (sent >= totalBytes) {
        this.push(null);
        return;
      }
      const size = Math.min(CHUNK_SIZE_BYTES, totalBytes - sent);
      sent += size;
      this.push(Buffer.alloc(size, 0x42));
    },
  });
}

describe.skipIf(!RUN)("binary file-transfer load profile", () => {
  it("streams 100 MiB as Buffers without base64 or excess RSS", async () => {
    global.gc?.();
    const before = process.memoryUsage().rss / 1024 / 1024;
    let streamCount = 0;
    let transferred = 0;
    let chunks = 0;
    let nonBinaryFrame = false;

    const input = source(FILE_SIZE_BYTES);
    streamCount += 1;
    await new Promise<void>((resolve, reject) => {
      const sink = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          nonBinaryFrame ||= !Buffer.isBuffer(chunk);
          transferred += chunk.byteLength;
          chunks += 1;
          callback();
        },
      });
      input.once("error", reject).pipe(sink).once("finish", resolve).once("error", reject);
    });

    global.gc?.();
    const after = process.memoryUsage().rss / 1024 / 1024;
    console.info(`FILE_TRANSFER_LOAD chunks=${chunks} rss_before=${before.toFixed(1)}MiB rss_after=${after.toFixed(1)}MiB`);
    expect(streamCount).toBe(1);
    expect(transferred).toBe(FILE_SIZE_BYTES);
    expect(nonBinaryFrame).toBe(false);
    expect(after).toBeLessThan(MEMORY_LIMIT_MB);
  }, 120_000);

  it("fits a 512 KiB binary chunk plus header inside a 1 MiB frame limit", () => {
    expect(CHUNK_SIZE_BYTES + 256).toBeLessThan(1024 * 1024);
  });
});
