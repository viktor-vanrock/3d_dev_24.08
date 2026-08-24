# Device-agent release signing and publication

Production releases are built from an immutable commit and one canonical semantic version. The same version and commit SHA must appear in the artifact name, signed manifest, runtime health diagnostics, and Relay agent identity.

## Key custody

- Keep the release private key outside the repository, CI logs, artifacts, container layers, and operator home backups used for ordinary development.
- Restrict signing to the release job or designated release workstation. Provide the private-key path through the job secret store; never pass the key contents on the command line.
- Distribute the public verification key through an independently trusted channel. Do not trust a public key downloaded beside an unverified artifact.
- Rotate keys with a documented overlap and revocation decision. Preserve old public keys only for verifying retained historical artifacts, not for signing new releases.

## Build, sign, verify, publish

1. Check out the exact commit with a clean nested `portal.ru` worktree.
2. Run the device-agent production release command with the version and full commit SHA. Missing signing tooling or private key is a hard failure.
3. Inspect the artifact allowlist: production bundle and source map, service/install/rollback tooling, manifest, checksums, signatures, and license notices only. Reject tests, fixtures, source secrets, workspace manifests, `workspace:*` dependencies, package-manager stores, and developer-only packages.
4. Verify the manifest signature, artifact signature, artifact SHA-256, version/commit equality, protocol compatibility, Node.js runtime requirement, and minimum compatible spool schema.
5. On a clean Linux/Node.js 22 host or container, verify install, start, health deadline, upgrade, tampered-artifact rejection, failed-start automatic rollback, and incompatible-downgrade rejection. The clean-host run must not mount the monorepo or package-manager store at runtime.
6. Publish only the already verified immutable bytes. Re-download them from the publication target and repeat signature and checksum verification.

Evidence records commands, exit codes, version, commit SHA, checksums, public key ID, container image digest, health response with secrets redacted, and rollback target. It never contains the signing key, enrollment/recovery credentials, JWTs, private keys, certificates, or environment-file contents.

Local build and clean-host results are repository-local evidence. They are not proof that DEV, TEST, PROD, or a customer fleet is deployed.

