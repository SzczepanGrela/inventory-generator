# Operational acceptance record — October 9, 2026

The coordinator accepted the following distinct scopes. Private topology and
raw operator logs remain in the infrastructure repository; this public record
contains no resource identifiers or credentials.

| Scope | Evidence and outcome |
| --- | --- |
| Normal protected release | [Run 37574806859](https://github.com/SzczepanGrela/inventory-generator/actions/runs/37574806859), revision `6971496`; combined CI, qualified digest and public exports passed. |
| Application clients and limits | October 8 paired public sources confirmed application-client separation, DOCX 429/Retry-After, recovery and sampled forwarded-header bypass rejection. Same-colo edge isolation remains separate. |
| Unhealthy candidate | [Run 37892036349](https://github.com/SzczepanGrela/inventory-generator/actions/runs/37892036349), isolated canary; bad health candidate discarded while the healthy baseline survived, then normal restoration. |
| Controlled failed-smoke rollback | [Run 37894951905](https://github.com/SzczepanGrela/inventory-generator/actions/runs/37894951905), qualified `d62e2dc` followed by exact restoration to stable `6971496`. Ordinary rollback handler and final exports passed. One independent runner probe warning remains unexplained; no zero-downtime claim. |
| Bounded rolling workload | October 9 final operator canary run: eight CSV/HTML/DOCX outputs passed structure checks, old SIGTERM/exit 0 and sole healthy replacement verified. Both public apps had 51 successful health probes; no stop or host-guard rejection. |

The final workload used the previously qualified 1000-row × 50-column payload
below 2 MiB, at most three requests per container and 1 CPU/512 MiB per instance.
Combined sampled canary memory peaked at 423.16 MiB. Public Inventory health
latency peaked at 0.174565 s and the neighbour at 0.183307 s. Host CPU peaked at
93.79%, without exceeding 85% for more than fifteen seconds. The two earlier
incomplete attempts remain historical, not retroactively passing results.

This accepts process-local counters for one ordinary process and brief
same-image rolling overlap with three export slots and no waiting queue. It
does not prove arbitrary sustained capacity, six constantly occupied server
slots, active-export drain after SIGTERM, permanent replicas or absence of all
future OOM risk. Strict global quotas or increased concurrency need a new review.

The temporary `Inventory operational acceptance` workflow, its three exercise
modules and post-smoke failure hook are retired in this cleanup change. Ordinary
[deployment](../.github/workflows/deploy.yml), release-client regression tests and
[operator procedures](operator-procedures.md) remain. Historical exercise source
is available in [PR #29](https://github.com/SzczepanGrela/inventory-generator/pull/29);
it is not a standing instruction to run another fault or load drill.

Removing code does not delete Coolify resources. Archiving logs, deleting only
identified temporary apps and unused dedicated resources, then verifying absence
remain coordinator/operator cleanup work. Monitoring/alert delivery, runtime
parser exceptions, credential scope and shared edge/recovery gaps retain their
own backlog entries.
