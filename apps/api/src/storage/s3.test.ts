import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteModelObject,
  generationPublicUrl,
  getModelObjectPresignedUrl,
  getModelObjectStream,
  isModelsStorageConfigured,
  isPublicOffloadEnabled,
  modelObjectKey,
  modelPublicUrl,
  putAuthObject,
  putModelObjectStream,
  withResponseOverrides,
} from "./s3.ts";

const fakeLog = { warn: () => {}, error: () => {} } as unknown as Parameters<typeof putAuthObject>[2];

// MF-754/755: bucket policy is fail-closed outside `public/*` — modelObjectKey must route each
// role to the prefix that matches the actual bucket policy, or new uploads land somewhere the
// policy doesn't cover (protected roles staying anonymously readable, or public roles going 403).
describe("modelObjectKey prefix routing (MF-754/755)", () => {
  it("routes protected roles under protected/", () => {
    for (const role of ["source", "canonical_3mf", "cnc_program", "drawing", "gerber", "code_archive", "aux"]) {
      expect(modelObjectKey("m1", role, "bin")).toBe(`protected/models/m1/${role}.bin`);
    }
  });

  it("routes non-protected roles under public/", () => {
    for (const role of ["preview", "thumbnail", "mobile_preview", "description_image"]) {
      expect(modelObjectKey("m1", role, "bin")).toBe(`public/models/m1/${role}.bin`);
    }
  });
});

// Аудит-запись в auth-бакет — best-effort, не критический путь (MF-455, регрессия найдена
// Cloud.ru-агентом в MF-454): сбой S3 не должен ронять регистрацию/логин пользователя.
// vi.resetModules() + динамический import — модуль s3.ts кеширует S3Client синглтоном
// (`let client`), поэтому фейковые env-креды здесь не должны влиять на общий инстанс модуля,
// которым пользуется интеграционный тест ниже (там могут быть настоящие креды MinIO).
describe("putAuthObject", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("does not throw when the S3 write fails", async () => {
    vi.stubEnv("S3_ENDPOINT", "http://127.0.0.1:1"); // порт закрыт — соединение гарантированно упадёт
    vi.stubEnv("S3_ACCESS_KEY", "test");
    vi.stubEnv("S3_SECRET_KEY", "test");
    vi.resetModules();
    const fresh = await import("./s3.ts");

    await expect(fresh.putAuthObject("test-key", Buffer.from("x"), fakeLog)).resolves.toBeUndefined();
  });
});

// Offload (MF-709): без S3_PUBLIC_ENDPOINT в env — фича выключена, вызывающий код продолжает
// проксировать (cutover без правки кода, см. комментарий у publicUrlBase в s3.ts).
describe("public offload URLs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled and returns null when S3_PUBLIC_ENDPOINT is unset", () => {
    vi.stubEnv("S3_PUBLIC_ENDPOINT", "");
    expect(isPublicOffloadEnabled()).toBe(false);
    expect(modelPublicUrl("models/x/canonical_3mf.3mf")).toBeNull();
    expect(generationPublicUrl("previews/x.webp")).toBeNull();
  });

  // Cloud.ru подтвердил живым curl (MF-715): голый path-style `s3.cloud.ru/<bucket>` не
  // резолвится анонимно (missing tenant id) — нет безопасного дефолта, стиль обязателен.
  it("stays disabled when S3_PUBLIC_ENDPOINT is set but S3_PUBLIC_URL_STYLE is missing/unknown", () => {
    vi.stubEnv("S3_PUBLIC_ENDPOINT", "https://s3.cloud.ru");
    expect(isPublicOffloadEnabled()).toBe(false);
    expect(modelPublicUrl("models/x/canonical_3mf.3mf")).toBeNull();

    vi.stubEnv("S3_PUBLIC_URL_STYLE", "path");
    expect(isPublicOffloadEnabled()).toBe(false);
    expect(modelPublicUrl("models/x/canonical_3mf.3mf")).toBeNull();
  });

  it("builds a virtual-hosted URL (Domain name) when S3_PUBLIC_URL_STYLE=vhost", () => {
    vi.stubEnv("S3_PUBLIC_ENDPOINT", "https://s3.cloud.ru");
    vi.stubEnv("S3_PUBLIC_URL_STYLE", "vhost");
    vi.stubEnv("S3_BUCKET_GENERATIONS", "generations");
    expect(isPublicOffloadEnabled()).toBe(true);
    expect(generationPublicUrl("previews/x.webp")).toBe("https://generations.s3.cloud.ru/previews/x.webp");
  });

  it("builds a global-name URL when S3_PUBLIC_URL_STYLE=global", () => {
    vi.stubEnv("S3_PUBLIC_ENDPOINT", "https://global.s3.cloud.ru");
    vi.stubEnv("S3_PUBLIC_URL_STYLE", "global");
    vi.stubEnv("S3_BUCKET_MODELS", "3mf-dev-global-name");
    expect(modelPublicUrl("models/x/canonical_3mf.3mf")).toBe("https://global.s3.cloud.ru/3mf-dev-global-name/models/x/canonical_3mf.3mf");
  });

  it("appends response-content-type/-disposition overrides as query params", () => {
    const url = withResponseOverrides("https://s3.cloud.ru/3mf/models/x/canonical_3mf.3mf", {
      contentType: "model/3mf",
      contentDisposition: 'attachment; filename="a.3mf"',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("response-content-type")).toBe("model/3mf");
    expect(parsed.searchParams.get("response-content-disposition")).toBe('attachment; filename="a.3mf"');
  });
});

// Presigned GET (MF-782) — приватные ключи вне public/* (fail-closed по MF-754 bucket policy).
describe.skipIf(!isModelsStorageConfigured())("getModelObjectPresignedUrl (integration, real bucket)", () => {
  it("signs a URL that actually retrieves the object, and expires past its TTL", async () => {
    const key = modelObjectKey(`presign-test-${Date.now()}`, "source", "stl");
    const body = Buffer.from("solid presign\nendsolid presign\n");
    await putModelObjectStream(key, Readable.from(body), "application/octet-stream");

    try {
      const url = await getModelObjectPresignedUrl(key);
      expect(url).toBeTruthy();
      expect(url).toContain(key);
      expect(url).toMatch(/X-Amz-Signature=/);

      const response = await fetch(url!);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer()).equals(body)).toBe(true);

      // Отрицательный TTL — уже истёкшая подпись. MinIO отвечает 400 (RequestTimeTooSkewed/
      // AccessDenied), реальный S3 API обычно 403 — в обоих случаях запрос отклонён, не 200.
      const expired = await getModelObjectPresignedUrl(key, -10);
      const expiredResponse = await fetch(expired!);
      expect([400, 403]).toContain(expiredResponse.status);
    } finally {
      await deleteModelObject(key);
    }
  });

  it("returns null when S3 is not configured", async () => {
    vi.stubEnv("S3_ENDPOINT", "");
    vi.stubEnv("S3_ACCESS_KEY", "");
    vi.stubEnv("S3_SECRET_KEY", "");
    vi.resetModules();
    const fresh = await import("./s3.ts");
    await expect(fresh.getModelObjectPresignedUrl("models/x/source.stl")).resolves.toBeNull();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // MF-755: Content-Disposition для protected-скачиваний (download.ts) должен быть подписан как
  // часть запроса (ResponseContentDisposition), а не дописан query-параметром поверх готовой
  // presigned-ссылки постфактум — иначе SigV4 отклоняет её (SignatureDoesNotMatch). Подпись — чисто
  // криптографическая операция, реальный бакет не нужен, только валидные по форме кредлы в env.
  it("bakes response-content-type/-disposition into the signed request, not as an appended query param", async () => {
    vi.stubEnv("S3_ENDPOINT", "http://127.0.0.1:1");
    vi.stubEnv("S3_ACCESS_KEY", "test");
    vi.stubEnv("S3_SECRET_KEY", "test");
    vi.resetModules();
    const fresh = await import("./s3.ts");

    const url = await fresh.getModelObjectPresignedUrl("protected/models/x/canonical_3mf.3mf", 60, {
      contentType: "model/3mf",
      contentDisposition: 'attachment; filename="a.3mf"',
    });
    expect(url).toBeTruthy();
    const parsed = new URL(url!);
    // signed params come from X-Amz-SignedHeaders/canonical query string, not appended after
    // signing — response-content-* must be present AND covered by the signature.
    expect(parsed.searchParams.get("response-content-type")).toBe("model/3mf");
    expect(parsed.searchParams.get("response-content-disposition")).toBe('attachment; filename="a.3mf"');
    expect(parsed.searchParams.get("X-Amz-Signature")).toBeTruthy();

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe.skipIf(!isModelsStorageConfigured())("account-scoped slice object policy (integration, real bucket)", () => {
  it("rejects an anonymous direct GET of another account's protected g-code with 403", async () => {
    const accountId = `account-a-${Date.now()}`;
    const key = `protected/slices/${accountId}/same-fingerprint.gcode`;
    await putModelObjectStream(key, Readable.from(Buffer.from("G1 X0 Y0\n")), "text/x-gcode");

    try {
      const endpoint = process.env.S3_ENDPOINT!.replace(/\/+$/, "");
      const bucket = encodeURIComponent(process.env.S3_BUCKET_MODELS ?? "3mf");
      const objectPath = key
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
      const response = await fetch(`${endpoint}/${bucket}/${objectPath}`);
      expect(response.status).toBe(403);
    } finally {
      await deleteModelObject(key);
    }
  });
});

// Интеграционный тест против реального бакета `3mf` (критерий MF-336/MF-455, ревизия
// MF-470 — presigned заменён на API-стриминг, docs/epics/marketplace.md §1 п.13): объект
// заливается и скачивается через getModelObjectStream. Пропускается, пока S3_* не заданы
// в env (MF-454 ещё выдаёт креды) — не должен ронять CI/типовой прогон без секретов.
describe.skipIf(!isModelsStorageConfigured())("model storage (integration, real bucket)", () => {
  it("uploads an object and streams it back", async () => {
    const key = modelObjectKey(`test-${Date.now()}`, "source", "stl");
    const body = Buffer.from("solid test\nendsolid test\n");

    await putModelObjectStream(key, Readable.from(body), "application/octet-stream");

    try {
      const object = await getModelObjectStream(key);
      expect(object).toBeTruthy();

      const chunks: Buffer[] = [];
      for await (const chunk of object!.body) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks).equals(body)).toBe(true);
    } finally {
      await deleteModelObject(key);
    }
  });

  it("returns null for a missing key", async () => {
    const object = await getModelObjectStream(modelObjectKey("does-not-exist", "source", "stl"));
    expect(object).toBeNull();
  });
});
