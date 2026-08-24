import { createHash } from "node:crypto";

export interface DeviceIdentityV1 {
  schema: "identity.v1";
  deviceId: string;
  model: string | null;
  agentVersion: string;
  klipperVersion: string | null;
  configFingerprint: string;
  configSource: "moonraker";
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function stable(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => {
      const entry = value[key];
      return `${JSON.stringify(key)}:${entry === undefined ? "undefined" : stable(entry)}`;
    }).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function configFingerprint(config: Record<string, unknown>): string {
  // Hash only printer.cfg-relevant safety/configuration data. Never include paths,
  // credentials, raw serials or MAC addresses in the payload or hash input.
  const relevant = Object.fromEntries(Object.entries(config).filter(([key]) =>
    /^(stepper|extruder|heater|bed_mesh|safe_z_home|probe|homing|printer|kinematics|fan|temperature|mcu|input_shaper|delta|gcode_macro)/i.test(key)));
  return createHash("sha256").update(stable(relevant as Json)).digest("hex");
}

export function buildIdentity(input: {
  deviceId: string;
  agentVersion: string;
  klipperVersion: string | null;
  model?: string | null;
  config: Record<string, unknown>;
}): DeviceIdentityV1 {
  return {
    schema: "identity.v1",
    deviceId: input.deviceId,
    model: input.model ?? null,
    agentVersion: input.agentVersion,
    klipperVersion: input.klipperVersion,
    configFingerprint: configFingerprint(input.config),
    configSource: "moonraker",
  };
}
