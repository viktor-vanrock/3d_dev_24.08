import { DeviceCommandRelayRepository } from "./device-command-relay.repository.ts";
import { pool } from "../../../db/client.ts";

const deviceId = process.env.RELAY_CRASH_TEST_DEVICE_ID;
const claimOwner = process.env.RELAY_CRASH_TEST_CLAIM_OWNER;

if (deviceId === undefined || claimOwner === undefined || process.send === undefined) {
  throw new Error("relay crash child requires device id, claim owner, and an IPC channel");
}

const repository = new DeviceCommandRelayRepository(pool);
const claimed = (await repository.claim({ claimOwner, authorizedDeviceIds: [deviceId], limit: 1 })).commands[0];

if (claimed === undefined) {
  throw new Error("relay crash child did not claim the queued command");
}

process.send({
  type: "claimed",
  claim: {
    commandId: claimed.commandId,
    commandSeq: claimed.commandSeq,
    claimOwner: claimed.claimOwner,
    claimToken: claimed.claimToken,
    generation: claimed.generation,
    attemptCount: claimed.attemptCount,
  },
});

setInterval(() => undefined, 60_000);
