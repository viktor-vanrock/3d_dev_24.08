import { isDeviceEnrollmentResponseV1, type DeviceEnrollmentResponseV1 } from "@portal/contracts/device-agent-runtime/v1";
import { generateEnrollmentCsr, writeEnrollmentCredentials } from "./credentials.ts";

export async function enrollDeviceAgent(input: {
  readonly apiUrl: string;
  readonly code: string;
  readonly agentVersion: string;
  readonly home: string;
  readonly recovery?: boolean;
}, request: typeof fetch = fetch): Promise<DeviceEnrollmentResponseV1> {
  if (!input.apiUrl || !input.code) throw new Error("MULTICA_API_URL and MULTICA_ENROLL_CODE are required");
  const generated = generateEnrollmentCsr(input.home);
  const endpoint = input.recovery ? "/devices/agent/recover" : "/devices/agent/enroll";
  const response = await request(new URL(endpoint, input.apiUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: input.code, agent_version: input.agentVersion, csr_pem: generated.csrPem }),
  });
  if (!response.ok) throw new Error(`device-agent enrollment failed with HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!isDeviceEnrollmentResponseV1(payload)) throw new Error("device-agent enrollment returned an invalid contract");
  writeEnrollmentCredentials(payload, input.home);
  return payload;
}
