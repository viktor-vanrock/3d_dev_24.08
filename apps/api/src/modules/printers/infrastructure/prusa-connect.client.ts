// Клиент Prusa Connect (MF-646) — облачный REST, а не PrusaLink/локальный протокол
// (см. описание карточки: цель именно обойти NAT-проблему MF-26). Единственный
// документированный публичный REST-контракт с шейпом "мой флот принтеров" —
// connect-mobile-api.prusa3d.com (OpenAPI-спека на /api/docs, endpoint GET /api/v1/printers,
// security "client_jwt_token" — bearer-токен). Официального описания процесса выпуска
// долгоживущего пользовательского ключа Prusa не публикует; трактуем ключ, который просит
// ввести карточка, как токен для этого заголовка. Это единственная известная точка входа —
// если у реального аккаунта токен не совпадает по формату, поймаем это как auth-ошибку
// (see PrusaAuthError ниже), не молча сломанную интеграцию.
const API_BASE = "https://connect-mobile-api.prusa3d.com/api/v1";

export class PrusaAuthError extends Error {
  constructor(message = "Prusa Connect отклонил API-ключ") {
    super(message);
    this.name = "PrusaAuthError";
  }
}

export interface PrusaPrinter {
  externalRef: string;
  name: string | null;
  modelName: string;
  state: string;
}

export interface PrusaConnectClient {
  listPrinters(apiKey: string): Promise<PrusaPrinter[]>;
}

interface RawPrinter {
  uuid?: unknown;
  name?: unknown;
  printerTypeName?: unknown;
  printerModel?: unknown;
  printerType?: unknown;
  state?: unknown;
}

function extractItems(body: unknown): RawPrinter[] {
  if (Array.isArray(body)) return body as RawPrinter[];
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as RawPrinter[];
    if (Array.isArray(obj["hydra:member"])) return obj["hydra:member"] as RawPrinter[];
  }
  return [];
}

function toPrinter(raw: RawPrinter): PrusaPrinter | null {
  if (typeof raw.uuid !== "string" || !raw.uuid) return null;
  const modelName =
    (typeof raw.printerTypeName === "string" && raw.printerTypeName) ||
    (typeof raw.printerModel === "string" && raw.printerModel) ||
    (typeof raw.printerType === "string" && raw.printerType) ||
    "";
  return {
    externalRef: raw.uuid,
    name: typeof raw.name === "string" ? raw.name : null,
    modelName,
    state: typeof raw.state === "string" ? raw.state : "UNKNOWN",
  };
}

export const prusaConnectClient: PrusaConnectClient = {
  async listPrinters(apiKey: string): Promise<PrusaPrinter[]> {
    const res = await fetch(`${API_BASE}/printers`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 401 || res.status === 403) throw new PrusaAuthError();
    if (!res.ok) throw new Error(`Prusa Connect API вернул ${res.status}`);

    const body = await res.json();
    return extractItems(body)
      .map(toPrinter)
      .filter((p): p is PrusaPrinter => p !== null);
  },
};
