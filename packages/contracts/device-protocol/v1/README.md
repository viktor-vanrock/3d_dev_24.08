# Device protocol v1

This directory is the canonical target wire contract for the NestJS relay and device-agent.

- `schema.json` defines closed directional frame unions and every concrete frame shape.
- `limits.json` defines transport and field-size limits that are not all expressible as JSON Schema character counts.
- `error-codes.json` defines stable wire, command-result, transfer-result and WebSocket close codes.
- `fixtures/valid.json` contains at least one golden case for every concrete frame type.
- `fixtures/invalid.json` contains schema, version-negotiation and transport-size rejection cases with the expected stable error.

The gateway identity comes from the verified individual mTLS certificate and is not accepted from an untrusted frame field. `hello.protocol_version` is mandatory and exactly `v1`; versionless clients are invalid and any other declared version is rejected as `unsupported_version` before session state is created.

`command_ack` means transport receipt only. `command_result` is the explicit authoritative device execution result. `file_start_ack` and `file_chunk_ack` carry the agent-confirmed next sequence and byte offset used for resume.

Consumers must enforce `max_text_frame_bytes` on UTF-8 bytes before JSON parsing, then select the directional union and validate the closed frame. Task 1.3 compiles the runtime validators/types and wires the drift gate; these JSON artifacts remain the authority.
