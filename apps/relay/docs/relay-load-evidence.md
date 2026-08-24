# Relay bounded load evidence

## Reproducible CI profile

Run from the repository root:

```sh
pnpm --filter @portal/relay test:load
```

The deterministic registry-level profile exercises the same admission, heartbeat, output-buffer and fencing paths used by live sessions:

- 512 simultaneously installed logical gateway sessions;
- 16,384 frame admissions and completions (32 per session);
- 16,384 current-session heartbeats;
- 256-byte outbound payloads;
- one deliberately backpressured session at the 64 KiB per-session output-buffer limit;
- explicit fast-session delivery while the slow session is rejected;
- explicit slow-session recovery after its buffered amount returns to zero.

The CI thresholds are:

| Signal | Threshold |
| --- | ---: |
| Frame admission p95 | <= 2 ms |
| Heartbeat p95 | <= 1 ms |
| Event-loop delay p95 | <= 20 ms |
| Event-loop delay max | <= 100 ms |
| RSS delta | <= 67,108,864 bytes (64 MiB) |
| Measured profile duration | <= 15,000 ms |
| Slow-session isolation and recovery | all assertions true |

## Local verification evidence

Captured on 2026-08-11 with Node.js/Vitest. Three focused independent process runs and one full relay-suite run passed. The ranges below include all four runs:

| Signal | Observed range |
| --- | ---: |
| Frame admission p95 | 0.000209-0.000416 ms |
| Heartbeat p95 | 0.000167-0.000333 ms |
| Event-loop delay p95/max | 1.391615-2.418687 ms |
| RSS delta | 5,193,728-6,389,760 bytes |
| Measured profile duration | 10.416291-23.671958 ms |
| Slow session rejected | true in 4/4 runs |
| Fast session delivered while slow | true in 4/4 runs |
| Slow session recovered | true in 4/4 runs |

This is a bounded local/CI regression gate, not a production capacity claim. It intentionally avoids external TLS, network and Portal API variability so changes to the relay's synchronous session admission and backpressure isolation remain deterministic and finish well inside the test budget.
