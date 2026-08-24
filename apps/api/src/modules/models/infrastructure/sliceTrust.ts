import {
  buildSliceTrustMaterial,
  SLICE_TRUST_CONTRACT_VERSION,
  SliceTrustContractError,
  type FingerprintAlgorithmVersion,
  type FingerprintState,
  type SliceTrustMaterial,
  type StockConfigInput,
} from "@portal/contracts/jobs/slicer";

export type SliceTrustApiErrorCode = "SLICE_TRUST_INVALID" | "SLICE_TRUST_VERSION_UNSUPPORTED" | "SLICE_TRUST_CONFLICT";

export class SliceTrustApiError extends Error {
  readonly code: SliceTrustApiErrorCode;

  constructor(code: SliceTrustApiErrorCode) {
    super(code);
    this.name = "SliceTrustApiError";
    this.code = code;
  }
}

export interface SliceTrustRequest {
  contract_version: unknown;
  profile_id: unknown;
  slice_key: unknown;
  fingerprint_source: unknown;
  fingerprint_state: unknown;
  stock_input?: unknown;
  config_fingerprint?: unknown;
  fingerprint_algorithm_version?: unknown;
}

export interface SliceTrustDeviceContext {
  accountId: string;
  deviceId: string;
  agentId: string | null;
  /** Последний принятый факт агента; null означает, что факт ещё не сохранён. */
  persistedConfigFingerprint: string | null;
}

export interface SliceTrustActor {
  /** null означает запрос от пользователя, а не от аутентифицированного агента. */
  authenticatedAgentId: string | null;
}

/**
 * Применяет API-политику к уже проверенной account↔device↔profile связке.
 * Идентификаторы аккаунта/устройства берутся из БД, а не из тела запроса.
 */
export function buildDeviceSliceTrustMaterial(input: SliceTrustRequest, device: SliceTrustDeviceContext, actor: SliceTrustActor): SliceTrustMaterial {
  if (input.contract_version !== SLICE_TRUST_CONTRACT_VERSION) {
    throw new SliceTrustApiError("SLICE_TRUST_VERSION_UNSUPPORTED");
  }
  if (!device.accountId || !device.deviceId || (Boolean(actor.authenticatedAgentId) && !device.agentId)) {
    throw new SliceTrustApiError("SLICE_TRUST_INVALID");
  }

  const source = input.fingerprint_source;
  if (source === "agent") {
    // Одной записи config_fingerprint в user_printers недостаточно: новый материал
    // принимается только в том же запросе, где предъявлен credential этого агента.
    if (!actor.authenticatedAgentId || actor.authenticatedAgentId !== device.agentId) {
      throw new SliceTrustApiError("SLICE_TRUST_INVALID");
    }
  } else if (source !== "declared") {
    throw new SliceTrustApiError("SLICE_TRUST_INVALID");
  }

  let material: SliceTrustMaterial;
  try {
    material = buildSliceTrustMaterial({
      account_id: device.accountId,
      device_id: device.deviceId,
      profile_id: input.profile_id as string,
      slice_key: input.slice_key as string,
      fingerprint_source: source,
      fingerprint_state: input.fingerprint_state as FingerprintState,
      stock_input: input.stock_input as StockConfigInput | undefined,
      config_fingerprint: input.config_fingerprint as string | undefined,
      fingerprint_algorithm_version: input.fingerprint_algorithm_version as FingerprintAlgorithmVersion | undefined,
    });
  } catch (error) {
    if (error instanceof SliceTrustContractError) throw new SliceTrustApiError("SLICE_TRUST_INVALID");
    throw error;
  }

  if (source === "agent" && device.persistedConfigFingerprint !== null && material.config_fingerprint !== device.persistedConfigFingerprint) {
    // Не переписываем уже принятый факт новым значением под тем же account-scoped ключом.
    throw new SliceTrustApiError("SLICE_TRUST_CONFLICT");
  }

  return material;
}
