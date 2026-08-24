declare const __AGENT_VERSION__: string | undefined;
declare const __AGENT_COMMIT_SHA__: string | undefined;

export interface AgentBuildInfo {
  readonly version: string;
  readonly commitSha: string;
}

export function loadAgentBuildInfo(environment: NodeJS.ProcessEnv = process.env): AgentBuildInfo | null {
  const embeddedVersion = typeof __AGENT_VERSION__ === "undefined" ? undefined : __AGENT_VERSION__;
  const embeddedCommitSha = typeof __AGENT_COMMIT_SHA__ === "undefined" ? undefined : __AGENT_COMMIT_SHA__;
  const version = embeddedVersion ?? environment.AGENT_VERSION;
  const commitSha = embeddedCommitSha ?? environment.AGENT_COMMIT_SHA;
  if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) return null;
  if (!commitSha || !/^[a-f0-9]{7,64}$/i.test(commitSha)) return null;
  return { version, commitSha: commitSha.toLowerCase() };
}

export function relayIdentityVersion(build: AgentBuildInfo): string {
  const suffix = `commit.${build.commitSha.slice(0, 12)}`;
  const identity = build.version.includes("+") ? `${build.version}.${suffix}` : `${build.version}+${suffix}`;
  if (identity.length > 64) throw new Error("release version is too long for device-protocol/v1 agent identity");
  return identity;
}
