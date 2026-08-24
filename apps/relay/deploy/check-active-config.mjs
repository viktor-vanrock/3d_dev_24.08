import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

function requireMatch(relativePath, pattern, description) {
  if (!pattern.test(read(relativePath))) {
    throw new Error(`${relativePath}: missing ${description}`);
  }
}

function rejectMatch(relativePath, pattern, description) {
  if (pattern.test(read(relativePath))) {
    throw new Error(`${relativePath}: contains obsolete ${description}`);
  }
}

requireMatch("pnpm-workspace.yaml", /^\s*-\s*["']?apps\/relay["']?\s*$/m, "@portal/relay workspace entry");
requireMatch("package.json", /"build:relay"\s*:\s*"pnpm --filter @portal\/relay\.\.\. run build"/, "compiled relay build script");
requireMatch("deploy/portal.deploy-dev.sh", /pnpm --filter @portal\/relay\.\.\. run build/, "compiled relay dev build");
rejectMatch("deploy/portal.deploy-dev.sh", /\bgo\s+build\b/, "Go relay build");
requireMatch("deploy/portal.deploy.sudoers", /systemctl restart portal\.relay-dev\.service/, "bounded dev relay restart permission");

for (const unit of ["apps/relay/deploy/portal.relay.service", "apps/relay/deploy/portal.relay-dev.service"]) {
  requireMatch(unit, /ExecStart=\/usr\/bin\/node .*apps\/relay\/dist\/main\.js/, "compiled Nest ExecStart");
  rejectMatch(unit, /dist\/relay(?:\s|$)/m, "Go binary ExecStart");
}

requireMatch("deploy/nginx.relay.3mf.tech.conf", /proxy_pass portal_relay_gateway_tls;/, "gateway TLS passthrough");
rejectMatch("deploy/nginx.relay.3mf.tech.conf", /location\s+\/?(?:relay\/ws|health|ready|metrics)/, "public HTTP relay location");

const environmentExample = read(".env.example");
for (const name of ["RELAY_SERVICE_TOKEN", "RELAY_API_BASE_URL", "RELAY_GATEWAY_PORT", "RELAY_OBSERVABILITY_PORT"]) {
  if (!new RegExp(`^${name}=`, "m").test(environmentExample)) throw new Error(`.env.example: missing ${name}`);
}
for (const legacyName of ["RELAY_" + "INTERNAL_TOKEN", "API_" + "INTERNAL_URL", "RELAY_" + "HEALTH_PORT"]) {
  if (new RegExp(`^${legacyName}=`, "m").test(environmentExample)) throw new Error(`.env.example: contains obsolete ${legacyName}`);
}

for (const metric of [
  "relay_active_sessions",
  "relay_auth_total",
  "relay_heartbeat_total",
  "relay_protocol_frames_total",
  "relay_backpressure_total",
  "relay_command_lifecycle_total",
  "relay_internal_api_requests_total",
]) {
  requireMatch("apps/relay/deploy/relay-dashboard.json", new RegExp(metric), `${metric} dashboard query`);
}

process.stdout.write("relay active workspace/deploy configuration: OK\n");
