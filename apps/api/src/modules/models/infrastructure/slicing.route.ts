import { serializeSliceTrustMaterial, type SliceTrustMaterial } from "@portal/contracts/jobs/slicer";
import { type PlatePreflightResult } from "@portal/contracts/jobs/slicer-plate";

// Очередь облачного слайсинга (MF-1078). Control-plane роуты поверх `slice_jobs` мигрированы в Nest
// (modules/models + nest/integration); здесь остаются только разделяемые чистые хелперы, которые
// импортируют Nest-адаптеры и storage: проверка dispatch-пригодности джобы по versioned slice-trust
// evidence (devices.adapters.ts) и распознавание account-scoped slice-объекта (storage/s3.ts).

interface SliceJobRow {
  id: string;
  profile_id: string;
  status: string;
  gcode_s3_key: string | null;
  error: string | null;
  metrics: Record<string, unknown> | null;
  slice_key: Buffer | null;
  account_id: string | null;
  device_id: string | null;
  requested_by: string;
  created_at: string;
  updated_at: string;
  slice_trust_material: SliceTrustMaterial | null;
  slice_trust_contract_version: string | null;
  slice_trust_key_id: string | null;
  slice_trust_signature: string | null;
  preflight: PlatePreflightResult | null;
  retryable: boolean;
  error_code: string | null;
  preview_manifest_s3_key: string | null;
}

export function isAccountScopedSliceObject(objectKey: string, accountId: string): boolean {
  if (!objectKey || !accountId) return false;
  const prefix = `protected/slices/${accountId}/`;
  const objectName = objectKey.startsWith(prefix) ? objectKey.slice(prefix.length) : "";
  return objectName.length > 0 && objectName.endsWith(".gcode") && !objectName.includes("/");
}

/**
 * Результат можно dispatch-ить только с полным versioned evidence, привязанным
 * к той же account/device/profile/slice-key строке. Legacy и повреждённые
 * записи не получают silent fallback к старому пути выдачи G-code.
 */
export function isDispatchableSliceJob(
  job: Pick<
    SliceJobRow,
    "account_id" | "device_id" | "profile_id" | "slice_key" | "slice_trust_contract_version" | "slice_trust_material" | "slice_trust_key_id" | "slice_trust_signature"
  >,
): boolean {
  const material = job.slice_trust_material;
  if (
    job.slice_trust_contract_version !== "slice-trust.v1" ||
    !material ||
    material.contract_version !== "slice-trust.v1" ||
    job.account_id === null ||
    job.device_id === null ||
    !job.slice_key ||
    material.account_id !== job.account_id ||
    material.device_id !== job.device_id ||
    material.profile_id !== job.profile_id ||
    material.slice_key !== job.slice_key.toString("hex") ||
    typeof job.slice_trust_key_id !== "string" ||
    !job.slice_trust_key_id.trim() ||
    typeof job.slice_trust_signature !== "string" ||
    !job.slice_trust_signature.trim()
  ) {
    return false;
  }
  try {
    serializeSliceTrustMaterial(material);
    return true;
  } catch {
    return false;
  }
}
