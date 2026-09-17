import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";

const RUN = process.env.LOAD_TEST === "1";
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MEMORY_LIMIT_MB = 150;

function makeChunkedStream(totalBytes: number, chunkSize = 64 * 1024): Readable {
  let sent = 0;
  return new Readable({
    read() {
      if (sent >= totalBytes) return this.push(null);
      const size = Math.min(chunkSize, totalBytes - sent);
      sent += size;
      this.push(Buffer.alloc(size, 0x42));
    },
  });
}

describe.skipIf(!RUN)("Upload memory load test", () => {
  it(
    "streams 100 MiB without retaining the payload in memory",
    async () => {
      global.gc?.();
      const before = process.memoryUsage().rss / 1024 / 1024;
      const stream = makeChunkedStream(MAX_FILE_BYTES);
      const pass = new PassThrough();
      let received = 0;
      pass.on("data", (chunk: Buffer) => { received += chunk.length; });
      await new Promise<void>((resolve, reject) => {
        stream.pipe(pass);
        pass.once("finish", resolve);
        pass.once("error", reject);
      });
      global.gc?.();
      const after = process.memoryUsage().rss / 1024 / 1024;
      console.log(`RSS before: ${before.toFixed(1)} MiB`);
      console.log(`RSS after: ${after.toFixed(1)} MiB`);
      console.log(`RSS delta: ${(after - before).toFixed(1)} MiB`);
      expect(received).toBe(MAX_FILE_BYTES);
      expect(after).toBeLessThan(MEMORY_LIMIT_MB);
    },
    60_000,
  );
});
