import type { ConnectorVendor, OperatorConfirmGate, PrinterEndpoint } from "./connector.ts";
import { FileConnectorTokenStore, type ConnectorTokenStore } from "./tokenStore.ts";

// Общий auth-хелпер для вендорных connect(): persist+reuse токена, и только если токена
// нет/протух — идти через OperatorConfirmGate (connector/common/README.md § «Auth-флоу»).
// Вендорный connect() зовёт это ДО собственного протокольного handshake:
//   const auth = await authenticateWithGate({ vendor, endpoint, savedToken: input.savedToken, confirmGate: input.confirmGate, reason, message });
//   if (!auth.ok) return { ok: false, error: auth.error };
//   // ... handshake с auth.token, если протокол его требует ...
// Если handshake с auth.token всё равно упал (протух незаметно для гейта), вендор
// повторяет вызов с forcePrompt:true, чтобы не тыкаться тихо повторно.

const defaultTokenStore = new FileConnectorTokenStore();

export interface AuthenticateWithGateInput {
  vendor: ConnectorVendor;
  endpoint: PrinterEndpoint;
  savedToken?: string;
  confirmGate: OperatorConfirmGate;
  reason: "confirm-on-printer" | "token-required";
  message: string;
  /** Пропустить сохранённый/переданный токен и всё равно спросить оператора (протух незаметно). */
  forcePrompt?: boolean;
  tokenStore?: ConnectorTokenStore;
}

export type AuthenticateWithGateResult = { ok: true; token?: string } | { ok: false; error: string };

export async function authenticateWithGate(input: AuthenticateWithGateInput): Promise<AuthenticateWithGateResult> {
  const store = input.tokenStore ?? defaultTokenStore;

  if (!input.forcePrompt) {
    const existing = input.savedToken ?? store.load(input.vendor, input.endpoint.host);
    if (existing) return { ok: true, token: existing };
  }

  const { approved, token } = await input.confirmGate.requestApproval({
    vendor: input.vendor,
    endpoint: input.endpoint,
    reason: input.reason,
    message: input.message,
  });

  if (!approved) {
    return { ok: false, error: "оператор не подтвердил подключение (отказ или таймаут ожидания ответа)" };
  }

  if (token) store.save(input.vendor, input.endpoint.host, token);
  return { ok: true, ...(token === undefined ? {} : { token }) };
}
