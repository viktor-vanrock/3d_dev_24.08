import { createHash } from "node:crypto";

/** Версия подписываемого материала API → Mesh; старые версии не принимаются молча. */
export const SLICE_TRUST_CONTRACT_VERSION = "slice-trust.v1" as const;
export const CONFIG_FINGERPRINT_ALGORITHM_VERSION = "config-fingerprint.v1" as const;
export const AGENT_CONFIG_FINGERPRINT_ALGORITHM_VERSION = "agent-config.v1" as const;

export type FingerprintSource = "agent" | "declared";
export type FingerprintState = "stock" | "custom" | "mismatch";
export type FingerprintAlgorithmVersion =
  | typeof CONFIG_FINGERPRINT_ALGORITHM_VERSION
  | typeof AGENT_CONFIG_FINGERPRINT_ALGORITHM_VERSION;

export class SliceTrustContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SliceTrustContractError";
  }
}

/**
 * Закрытый набор свойств стоковой конфигурации. Идентификаторы принадлежат каталогу,
 * не конкретному `user_printers`; числовые значения — целые в заданных единицах.
 */
export interface StockConfigInput {
  printer_model_id: string;
  stock_profile_id: string;
  nozzle_diameter_um: number;
  build_volume_mm: { x: number; y: number; z: number };
  kinematics: string;
  firmware_family: string;
  firmware_revision: string;
}

export interface SliceTrustMaterial {
  contract_version: typeof SLICE_TRUST_CONTRACT_VERSION;
  account_id: string;
  device_id: string;
  profile_id: string;
  slice_key: string;
  fingerprint_source: FingerprintSource;
  fingerprint_state: FingerprintState;
  fingerprint_algorithm_version: FingerprintAlgorithmVersion;
  config_fingerprint: string;
  canonical_config_fingerprint: string | null;
  /** v1 всегда false: ни agent, ни declared не открывают cross-account выдачу. */
  cross_account_reuse: false;
  /** Сигнал для lookup: в v1 глобальный dedup ещё не разрешён. */
  global_dedup_eligible: false;
}

type SliceTrustMaterialInput = Omit<SliceTrustMaterial,
  | "contract_version"
  | "fingerprint_algorithm_version"
  | "config_fingerprint"
  | "canonical_config_fingerprint"
  | "cross_account_reuse"
  | "global_dedup_eligible"
> & {
  stock_input?: StockConfigInput;
  config_fingerprint?: string;
  fingerprint_algorithm_version?: FingerprintAlgorithmVersion;
};

const STOCK_KEYS = [
  "printer_model_id",
  "stock_profile_id",
  "nozzle_diameter_um",
  "build_volume_mm",
  "kinematics",
  "firmware_family",
  "firmware_revision",
] as const;
const VOLUME_KEYS = ["x", "y", "z"] as const;
const IDENTIFIER = /^[a-z0-9][a-z0-9._/-]*$/;
const HEX_256 = /^[a-f0-9]{64}$/;

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SliceTrustContractError(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], name: string): void {
  if (Object.keys(value).length !== keys.length || !keys.every((key) => key in value)) {
    throw new SliceTrustContractError(`${name} has missing or unknown fields`);
  }
}

function normalizedIdentifier(value: unknown, name: string): string {
  if (typeof value !== "string") throw new SliceTrustContractError(`${name} must be a string`);
  const normalized = value.trim().toLowerCase();
  if (!IDENTIFIER.test(normalized)) throw new SliceTrustContractError(`${name} must be a non-empty catalog identifier`);
  return normalized;
}

function revision(value: unknown): string {
  if (typeof value !== "string") throw new SliceTrustContractError("firmware_revision must be a string");
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new SliceTrustContractError("firmware_revision must be a non-empty ASCII revision");
  }
  return normalized;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new SliceTrustContractError(`${name} must be a positive safe integer`);
  }
  return value as number;
}

/**
 * Нормализует вход без потери значений: имена каталога lower-case/trim, revision trim,
 * размеры и сопло — целые. Свойства и вложенный volume записываются строго лексикографически.
 */
export function canonicalizeStockConfig(input: unknown): string {
  const source = record(input, "stock_input");
  exactKeys(source, STOCK_KEYS, "stock_input");
  const volume = record(source.build_volume_mm, "build_volume_mm");
  exactKeys(volume, VOLUME_KEYS, "build_volume_mm");
  return JSON.stringify({
    build_volume_mm: {
      x: positiveInteger(volume.x, "build_volume_mm.x"),
      y: positiveInteger(volume.y, "build_volume_mm.y"),
      z: positiveInteger(volume.z, "build_volume_mm.z"),
    },
    firmware_family: normalizedIdentifier(source.firmware_family, "firmware_family"),
    firmware_revision: revision(source.firmware_revision),
    kinematics: normalizedIdentifier(source.kinematics, "kinematics"),
    nozzle_diameter_um: positiveInteger(source.nozzle_diameter_um, "nozzle_diameter_um"),
    printer_model_id: normalizedIdentifier(source.printer_model_id, "printer_model_id"),
    stock_profile_id: normalizedIdentifier(source.stock_profile_id, "stock_profile_id"),
  });
}

/** SHA-256 от UTF-8 канонического JSON, всегда lower-case hex из 64 символов. */
export function createConfigFingerprint(input: unknown): string {
  return createHash("sha256").update(canonicalizeStockConfig(input), "utf8").digest("hex");
}

function opaqueId(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new SliceTrustContractError(`${name} must be a non-empty trimmed opaque id`);
  }
  return value;
}

function fingerprint(value: unknown, name: string): string {
  if (typeof value !== "string" || !HEX_256.test(value)) throw new SliceTrustContractError(`${name} must be lower-case sha256 hex`);
  return value;
}

/**
 * Строит единственный материал, который API передаёт Mesh и который Mesh передаёт signer.
 * `declared` описывает заявление и в v1 не снимает account-scoping; custom/mismatch никогда
 * не получают canonical_config_fingerprint.
 */
export function buildSliceTrustMaterial(input: SliceTrustMaterialInput): SliceTrustMaterial {
  const source = input.fingerprint_source;
  const state = input.fingerprint_state;
  if (source !== "agent" && source !== "declared") throw new SliceTrustContractError("unknown fingerprint_source");
  if (state !== "stock" && state !== "custom" && state !== "mismatch") throw new SliceTrustContractError("unknown fingerprint_state");
  if (source === "declared" && state !== "stock") {
    throw new SliceTrustContractError("declared custom or mismatch configuration has no agent fact");
  }

  let configFingerprint: string;
  let canonicalConfigFingerprint: string | null = null;
  let algorithmVersion: FingerprintAlgorithmVersion;

  if (state === "stock") {
    if (!input.stock_input) throw new SliceTrustContractError("stock configuration requires stock_input");
    if (input.config_fingerprint !== undefined || input.fingerprint_algorithm_version !== undefined) {
      throw new SliceTrustContractError("stock configuration derives its fingerprint from stock_input");
    }
    configFingerprint = createConfigFingerprint(input.stock_input);
    canonicalConfigFingerprint = configFingerprint;
    algorithmVersion = CONFIG_FINGERPRINT_ALGORITHM_VERSION;
  } else {
    if (input.stock_input !== undefined) throw new SliceTrustContractError("custom or mismatch configuration must not provide stock_input");
    configFingerprint = fingerprint(input.config_fingerprint, "config_fingerprint");
    if (input.fingerprint_algorithm_version !== AGENT_CONFIG_FINGERPRINT_ALGORITHM_VERSION) {
      throw new SliceTrustContractError("custom or mismatch configuration requires agent-config.v1");
    }
    algorithmVersion = AGENT_CONFIG_FINGERPRINT_ALGORITHM_VERSION;
  }

  return {
    contract_version: SLICE_TRUST_CONTRACT_VERSION,
    account_id: opaqueId(input.account_id, "account_id"),
    device_id: opaqueId(input.device_id, "device_id"),
    profile_id: opaqueId(input.profile_id, "profile_id"),
    slice_key: fingerprint(input.slice_key, "slice_key"),
    fingerprint_source: source,
    fingerprint_state: state,
    fingerprint_algorithm_version: algorithmVersion,
    config_fingerprint: configFingerprint,
    canonical_config_fingerprint: canonicalConfigFingerprint,
    cross_account_reuse: false,
    global_dedup_eligible: false,
  };
}

/**
 * Exact UTF-8 signing input. Менять порядок, опускать поле или принимать другую contract_version
 * запрещено: verifier должен проверять ровно эту строку до доступа к G-code.
 */
export function serializeSliceTrustMaterial(material: SliceTrustMaterial): string {
  if (material.contract_version !== SLICE_TRUST_CONTRACT_VERSION) {
    throw new SliceTrustContractError("unsupported slice trust contract_version");
  }
  if (material.cross_account_reuse !== false) throw new SliceTrustContractError("v1 forbids cross-account reuse");
  if (material.global_dedup_eligible !== false) throw new SliceTrustContractError("v1 forbids global dedup");
  return JSON.stringify({
    account_id: opaqueId(material.account_id, "account_id"),
    canonical_config_fingerprint: material.canonical_config_fingerprint === null
      ? null
      : fingerprint(material.canonical_config_fingerprint, "canonical_config_fingerprint"),
    config_fingerprint: fingerprint(material.config_fingerprint, "config_fingerprint"),
    contract_version: SLICE_TRUST_CONTRACT_VERSION,
    cross_account_reuse: false,
    device_id: opaqueId(material.device_id, "device_id"),
    fingerprint_algorithm_version: material.fingerprint_algorithm_version,
    fingerprint_source: material.fingerprint_source,
    fingerprint_state: material.fingerprint_state,
    global_dedup_eligible: false,
    profile_id: opaqueId(material.profile_id, "profile_id"),
    slice_key: fingerprint(material.slice_key, "slice_key"),
  });
}
