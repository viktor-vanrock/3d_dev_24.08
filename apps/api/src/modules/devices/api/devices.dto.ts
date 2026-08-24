import { Allow } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { DeviceCommandResult } from "../public/index.ts";

export class DeviceLooseBodyDto {
  @ApiPropertyOptional({ type: String }) @Allow() firmware_class?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() label?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() device_id?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() reason?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() code?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() agent_version?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() user_id?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() role?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() command?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() transfer_id?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() file_name?: unknown;
  @ApiPropertyOptional({ type: Number }) @Allow() size_bytes?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() sha256?: unknown;
  @ApiPropertyOptional({ type: Boolean }) @Allow() start_print?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() profile_id?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() csr_pem?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() slice_job_id?: unknown;
  @ApiPropertyOptional({ type: Number }) @Allow() copies?: unknown;
}

export class DeviceOkDto {
  @ApiProperty({ enum: [true] }) declare readonly ok: true;
}
export class DeviceEnrollCodeDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String, writeOnly: true }) declare readonly code: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly expires_at: string;
  @ApiProperty({ type: String }) declare readonly install_command: string;
  @ApiProperty({ type: String }) declare readonly docker_command: string;
}
export class DeviceCommandVerificationKeyDto {
  @ApiProperty({ type: String }) declare readonly kid: string;
  @ApiProperty({ enum: ["EdDSA"] }) declare readonly alg: "EdDSA";
  @ApiProperty({ enum: ["OKP"] }) declare readonly kty: "OKP";
  @ApiProperty({ enum: ["Ed25519"] }) declare readonly crv: "Ed25519";
  @ApiProperty({ type: String }) declare readonly x: string;
}
export class DeviceCommandVerificationKeySetDto {
  @ApiProperty({ enum: ["device-agent-runtime.v1"] }) declare readonly version: "device-agent-runtime.v1";
  @ApiProperty({ type: String }) declare readonly issuer: string;
  @ApiProperty({ type: String }) declare readonly audience: string;
  @ApiProperty({ type: [DeviceCommandVerificationKeyDto], maxItems: 2, minItems: 1 }) declare readonly keys: readonly DeviceCommandVerificationKeyDto[];
}
export class DeviceEnrollmentDto {
  @ApiPropertyOptional({ enum: ["device-agent-runtime.v1"] }) declare readonly version?: "device-agent-runtime.v1";
  @ApiProperty({ type: String, format: "uuid" }) declare readonly agent_id: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) declare readonly gateway_id?: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly device_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly owner_id: string;
  @ApiPropertyOptional({ type: String, writeOnly: true }) declare readonly credential?: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly expires_at: string | null;
  @ApiPropertyOptional({ type: String }) declare readonly certificate_pem?: string;
  @ApiPropertyOptional({ type: [String] }) declare readonly certificate_chain_pem?: readonly string[];
  @ApiPropertyOptional({ type: [String] }) declare readonly ca_bundle_pem?: readonly string[];
  @ApiPropertyOptional({ type: String }) declare readonly certificate_fingerprint_sha256?: string;
  @ApiPropertyOptional({ type: DeviceCommandVerificationKeySetDto }) declare readonly command_verification?: DeviceCommandVerificationKeySetDto;
}
export class DeviceShareDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly device_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly user_id: string;
  @ApiProperty({ type: String }) declare readonly role: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly updated_at: string;
}
export class DeviceShareEnvelopeDto {
  @ApiProperty({ type: DeviceShareDto }) declare readonly share: DeviceShareDto;
}
export class DeviceCommandDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly command_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly correlation_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly device_id: string;
  @ApiProperty({ type: String }) declare readonly command: string;
  @ApiProperty({ type: Number }) declare readonly seq: number;
  @ApiProperty({ enum: ["queued", "leased", "delivered", "acknowledged", "executed", "failed", "expired"] }) declare readonly status: string;
  @ApiPropertyOptional({
    type: "object",
    nullable: true,
    properties: { ok: { type: "boolean" }, status: { type: "string" }, error_code: { type: "string" }, code: { type: "string" }, message: { type: "string" } },
  })
  declare readonly result: DeviceCommandResult | null;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly error_code: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly error_message: string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly acked_at: string | null;
  @ApiPropertyOptional({ type: String, writeOnly: true }) declare readonly token?: string;
  @ApiPropertyOptional({ type: String, format: "date-time" }) declare readonly token_expires_at?: string;
}
export class DeviceTransferDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly transfer_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly device_id: string;
  @ApiProperty({ type: String }) declare readonly file_name: string;
  @ApiProperty({ type: Number }) declare readonly size_bytes: number;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly sha256: string | null;
  @ApiProperty({ type: Boolean }) declare readonly start_print: boolean;
  @ApiProperty({ enum: ["gcode", "printer_profile"] }) declare readonly kind: string;
  @ApiProperty({ enum: ["initiated"] }) declare readonly status: "initiated";
  @ApiProperty({ type: Number }) declare readonly next_seq: number;
  @ApiProperty({ type: Number }) declare readonly bytes_transferred: number;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly error_code: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly error_message: string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly updated_at: string;
}
export class DeviceIncidentDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly device_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly thread_id: string;
  @ApiProperty({ type: String }) declare readonly event_type: string;
  @ApiProperty({ type: String }) declare readonly severity: string;
  @ApiProperty({ type: String }) declare readonly status: string;
  @ApiProperty({ type: Number }) declare readonly occurrence_count: number;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly first_seen_at: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly last_seen_at: string;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly acknowledged_at: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare readonly resolved_at: string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly updated_at: string;
}
export class DeviceIncidentListDto {
  @ApiProperty({ type: [DeviceIncidentDto] }) declare readonly items: readonly DeviceIncidentDto[];
}
export class DeviceIncidentEnvelopeDto {
  @ApiProperty({ type: DeviceIncidentDto }) declare readonly incident: DeviceIncidentDto;
}
export class DeviceProfileTransferDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly transfer_id: string;
  @ApiProperty({ type: String }) declare readonly status: string;
  @ApiProperty({ type: String }) declare readonly file_name: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly profile_id: string;
  @ApiProperty({ type: String }) declare readonly disclaimer: string;
}
export class DevicePrintRequestDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly device_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly slice_job_id: string;
  @ApiProperty({ type: Number }) declare readonly copies: number;
  @ApiProperty({ type: String }) declare readonly status: string;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly gcode_sha256: string | null;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly transfer_id: string;
  @ApiPropertyOptional({ type: String, format: "uuid", nullable: true }) declare readonly start_command_id: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly error_code: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) declare readonly error_message: string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly updated_at: string;
  @ApiPropertyOptional({ type: String, writeOnly: true }) declare readonly token?: string;
  @ApiPropertyOptional({ type: String, format: "date-time" }) declare readonly token_expires_at?: string;
}
