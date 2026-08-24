// Generated from schema.json by generate-types.mjs. DO NOT EDIT.

export type Identifier = string;

export type Sequence = number;

export type Sha256 = string;

export type Capability = "camera" | "heated_bed" | "heated_chamber" | "multi_extruder" | "file_transfer" | "cmd.pause" | "cmd.resume" | "cmd.cancel" | "cmd.start";

export type DeviceStatus = "printing" | "ready" | "idle" | "paused" | "error" | "offline";

export type SafeScalar = number | string | boolean | null;

export type HeartbeatDevice = {
  readonly device_id: Identifier;
  readonly status: DeviceStatus;
  readonly sequence: Sequence;
  readonly progress_percent?: number | null;
  readonly metrics?: Readonly<Record<string, SafeScalar>>;
  readonly identity?: Readonly<Record<string, string>>;
};

export type AuthorizedDevice = {
  readonly device_id: Identifier;
  readonly firmware_class?: string | null;
};

export type HelloChallenge = {
  readonly type: "hello_challenge";
  readonly nonce: string;
};

export type Hello = {
  readonly type: "hello";
  readonly protocol_version: "v1";
  readonly nonce: string;
  readonly agent_version: string;
  readonly printer_model?: string;
  readonly firmware_class?: string;
  readonly capabilities: ReadonlyArray<Capability>;
};

export type HelloAck = {
  readonly type: "hello_ack";
  readonly session_id: Identifier;
  readonly gateway_id: Identifier;
  readonly devices: ReadonlyArray<AuthorizedDevice>;
  readonly heartbeat_interval_seconds: number;
  readonly heartbeat_timeout_seconds: number;
};

export type Heartbeat = {
  readonly type: "heartbeat";
  readonly message_id: Identifier;
  readonly devices: ReadonlyArray<HeartbeatDevice>;
};

export type HeartbeatAck = {
  readonly type: "heartbeat_ack";
  readonly message_id: Identifier;
  readonly accepted_device_ids: ReadonlyArray<Identifier>;
};

export type EmptyCommandPayload = Readonly<Record<string, never>>;

export type StartCommandPayload = {
  readonly file_name: string;
};

export type Command = {
  readonly type: "command";
  readonly device_id: Identifier;
  readonly command_id: Identifier;
  readonly command_seq: Sequence;
  readonly command: "pause" | "resume" | "cancel";
  readonly command_token: string;
  readonly payload: EmptyCommandPayload;
} | {
  readonly type: "command";
  readonly device_id: Identifier;
  readonly command_id: Identifier;
  readonly command_seq: Sequence;
  readonly command: "start";
  readonly command_token: string;
  readonly payload: StartCommandPayload;
};

export type CommandAck = {
  readonly type: "command_ack";
  readonly device_id: Identifier;
  readonly command_id: Identifier;
  readonly command_seq: Sequence;
};

export type CommandResult = {
  readonly type: "command_result";
  readonly device_id: Identifier;
  readonly command_id: Identifier;
  readonly command_seq: Sequence;
  readonly outcome: "executed";
} | {
  readonly type: "command_result";
  readonly device_id: Identifier;
  readonly command_id: Identifier;
  readonly command_seq: Sequence;
  readonly outcome: "failed";
  readonly error_code: "device_not_authorized" | "device_unavailable" | "command_not_supported" | "role_not_allowed" | "replay_rejected" | "invalid_command" | "invalid_command_token" | "command_failed" | "command_timeout";
  readonly message?: string;
};

export type FileStart = {
  readonly type: "file_start";
  readonly device_id: Identifier;
  readonly transfer_id: Identifier;
  readonly file_name: string;
  readonly size_bytes: number;
  readonly sha256: Sha256;
  readonly object_version: Identifier;
  readonly kind: "gcode" | "printer_profile";
  readonly start_print: boolean;
  readonly chunk_size_bytes: number;
};

export type FileStartAck = {
  readonly type: "file_start_ack";
  readonly device_id: Identifier;
  readonly transfer_id: Identifier;
  readonly next_seq: Sequence;
  readonly next_offset_bytes: number;
};

export type FileChunk = {
  readonly type: "file_chunk";
  readonly device_id: Identifier;
  readonly transfer_id: Identifier;
  readonly seq: Sequence;
  readonly offset_bytes: number;
  readonly last: boolean;
  readonly data_base64: string;
};

export type FileChunkAck = {
  readonly type: "file_chunk_ack";
  readonly device_id: Identifier;
  readonly transfer_id: Identifier;
  readonly seq: Sequence;
  readonly next_seq: Sequence;
  readonly next_offset_bytes: number;
};

export type FileResult = {
  readonly type: "file_result";
  readonly device_id: Identifier;
  readonly transfer_id: Identifier;
  readonly outcome: "stored";
  readonly stored_as: string;
} | {
  readonly type: "file_result";
  readonly device_id: Identifier;
  readonly transfer_id: Identifier;
  readonly outcome: "failed";
  readonly error_code: "device_not_authorized" | "invalid_transfer" | "transfer_conflict" | "unknown_transfer" | "invalid_sequence" | "invalid_data" | "source_changed" | "file_size_mismatch" | "checksum_mismatch" | "upload_failed" | "start_failed" | "transfer_timeout";
  readonly next_seq?: Sequence;
  readonly next_offset_bytes?: number;
  readonly message?: string;
};

export type Error = {
  readonly type: "error";
  readonly code: "invalid_frame" | "unknown_frame_type" | "frame_too_large" | "unsupported_version" | "authentication_failed" | "authorization_failed" | "device_not_authorized" | "rate_limited" | "backpressure_limit" | "internal_error";
  readonly message?: string;
  readonly correlation_id?: Identifier;
};

export type GatewayToRelayFrame = Hello | Heartbeat | CommandAck | CommandResult | FileStartAck | FileChunkAck | FileResult;

export type RelayToGatewayFrame = HelloChallenge | HelloAck | HeartbeatAck | Command | FileStart | FileChunk | Error;

export type AnyFrame = GatewayToRelayFrame | RelayToGatewayFrame;
