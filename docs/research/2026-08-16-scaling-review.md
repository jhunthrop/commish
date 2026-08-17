# Scaling & Production-Readiness Review

Full adversarial review of the 8-phase build plan, run against all phase files and the strategy doc. See `plans/00-roadmap.md` for the triaged action list this produced.

**Verified absences across all 8 phase files (grep-confirmed, zero hits):** `load test`, `k6`, `artillery`, `capacity`, `throughput`, `benchmark`, `stress`, `N+1`, `EXPLAIN`, `query plan`, `pgbouncer`, `read replica`, `PITR`, `point-in-time`, `disaster`, `CDN`, `multi-region`, `autoscal`, `SIGTERM`, `shutdown`, `APM`, `Sentry`, `error tracking`, `SELECT FOR UPDATE`, `serializable`, `XPENDING`, `XAUTOCLAIM`.

---

## CRITICAL — would cause the exact ESPN-style peak-Sunday outage

### C1. The live-scoring ingestion & fan-out pipeline is unowned across all 8 phases
Phase 1 uses a static mock season; Phase 2 Step 4 builds only a pull seam with no polling cadence, fan-out design, or scoping. A naive implementation (recompute every roster on every stat tick) is O(leagues × teams × starters) every few seconds — at 5,000 leagues that's ~60,000 roster recomputations per tick at the highest-concurrency moment of the week.
**Fix:** A dedicated ingestion worker (not per-request), delta-diffing, an inverted `playerId → affected rosters` index so recomputation is scoped, batched per-league stream writes, and a Redis-cached computed-score layer keyed by `(leagueId, week, statsVersion)`.

### C2. No load testing exists in any phase
The strategy doc names this as a required non-functional requirement. The entire concurrency evidence base is a two-client integration test and a manual two-browser check. The ~200ms fanout latency claim in Phase 1 is asserted, never measured.
**Fix:** Named load scenarios (Sunday live-scoring ramp to 10k connections, 200 simultaneous drafts, AI burst, reconnect storm) with pass/fail thresholds, recorded results, re-run as a Phase 8 go-live gate.

### C3. Redis consumer-group design does not broadcast — it distributes (FIXED IN PLAN)
`XREADGROUP` partitions stream entries across consumers in a group — each entry goes to exactly one consumer, not all of them. As originally specified, a 12-person draft would deliver each pick to only one of the twelve browsers. Additionally, "resume from last-acknowledged entry ID" is `XREAD` semantics, not consumer-group semantics, and nothing addressed consumer-group cleanup (`XGROUP DESTROY`, `XAUTOCLAIM`), so every dropped connection would leak a permanent group, growing Redis memory unboundedly.
**Fix applied:** plain `XREAD BLOCK` from a per-connection last-seen entry ID, using the browser's native `Last-Event-ID` header (which `EventSource` supplies automatically) for resume. No consumer groups, no cleanup burden, same settled architecture.

### C4. In-memory draft session store is incompatible with more than one instance
The SSE *read* path fans out correctly via Redis, but the authoritative *write* path (the live draft session store) is process-local memory. With ≥2 instances, a pick landing on instance 1 is invisible to instance 2 (split-brain, worse for auction budget tracking). Any restart/deploy/crash mid-draft destroys all in-progress draft state with no recovery path.
**Fix:** persist every accepted draft action to an append-only `draft_actions` table inside the validating transaction; rebuild state by replaying actions (the existing pure-reducer `DraftEngine` is already suited to this); hold materialized state in Redis as a cache with a per-draft lock (`SELECT ... FOR UPDATE` on the draft row) for single-writer semantics; add a two-instance test and a crash-recovery test.

### C5. No database indexes, query plans, or N+1 analysis anywhere
Specific hot paths that will table-scan at real volume: `audit_events` (fastest-growing table, unindexed by leagueId/actorId/eventType/time), `getUserBalance` as a full SUM over ledger rows on every balance read, `getStateNetRevenue`/`getUserAnnualNetProfit` unindexed scans, and `generateAnnualTaxForms` as a per-user loop (200k queries at 100k users).
**Fix:** concrete indexes on all of the above; replace balance-as-SUM with a maintained rollup row updated in the same transaction as each posting (keeping the append-only ledger as the reconciliation source of truth); make the annual tax-form job set-based SQL with cursor-paginated batches and a unique `(userId, taxYear, formType)` constraint for idempotent resume.

### C6. No database backup, PITR, or disaster recovery anywhere across 8 phases
For a real-money regulated product this is the most serious omission after C1–C4: losing the ledger table means being unable to tell users what they're owed, unable to reconcile to the FBO account, unable to file 1099s — a regulatory incident, not an outage. Redis persistence policy was also never decided.
**Fix:** automated daily base backups + WAL archiving (RPO ≤ 5 min / RTO ≤ 1 hr), a written and *executed* restore runbook, quarterly restore drills, explicit Redis AOF persistence, and a Phase 8 go-live gate requiring at least one successful restore drill against production-shaped data.

---

## IMPORTANT

- **I1. Payment ledger races.** No lock on league capacity (two users can both win the "last seat," overfilling a league) or on balance checks across concurrent contests (two joins to different contests can both pass a sufficient-balance check against the same pre-debit SUM, producing a negative balance the product explicitly promises never happens). Fix: `SELECT ... FOR UPDATE` on the league row for capacity, on the balance rollup row for spend, plus a `CHECK (balance_cents >= 0)` constraint as a backstop.
- **I2. AI layer has per-user budget guards but no global ceiling, no queueing, and unbatched fan-out jobs.** A per-user cap times enough users is still an unbounded bill; waiver alerts and win-probability jobs fire one inference call per team as a burst, with no concurrency limit — at scale this 429s the provider and takes the interactive advisor down with it. Fix: global spend ceiling with tiered degradation, a Redis-backed queue for non-interactive AI work with bounded concurrency, a provider concurrency semaphore with backoff-with-jitter, and prompt caching for the stable per-league system-prompt prefix.
- **I3. Tax/compliance batch jobs are non-resumable.** Per-user loops with no checkpointing; a job dying at user 60,000 has no safe resume path, risking duplicate e-filings. Fix: set-based SQL, checkpointed batches, unique constraints for idempotency.
- **I4. Single-region deployment has no CDN, no documented latency decision, and no failure-domain acknowledgment.** Multi-region Postgres is correctly out of scope for now, but static assets have no CDN, and single-region-as-a-single-failure-domain during a Sunday window is never acknowledged as an accepted risk. Fix: CDN in front of static assets (also solves I7's DDoS layer), a written decision doc with measured latency for the geographic extremes of the Tier 1 state list, and a documented (if manual) region-failure playbook.
- **I5. No horizontal-scaling mechanics.** No autoscaling policy, no graceful SIGTERM handling (a rolling deploy currently drops every live SSE connection and, per C4, every in-progress draft), no deploy-freeze window, and a health check that only verifies DB connectivity — blind to a dead Redis connection, the most likely partial failure. Fix: scaling policy, graceful-drain SIGTERM handler, a documented deploy-freeze calendar enforced in CI, and split liveness/readiness health checks.
- **I6. No caching layer.** Every read hits Postgres, including standings/matchup views recomputed from raw stat lines on every page view — read load scales with refresh rate, not user count, which is exactly the read-amplification pattern that turns a busy Sunday into an outage. Fix: Redis cache (already-justified infrastructure) for player/ranking data, per-league scoring settings, and computed weekly scores keyed by a stats-version that the ingestion pipeline bumps on change.
- **I7. No general API rate limiting or abuse protection**, and a promised "dedicated security-hardening phase" is deferred in Phase 2 but never actually created anywhere. Fix: Redis-backed rate limiting as middleware, a per-user/per-IP concurrent-SSE-connection cap, the I4 CDN as a WAF/DDoS layer, and either creating the promised phase or explicitly folding it into Phase 8's go-live checklist.
- **I8. Redis is a single point of failure with no HA or degradation story.** No persistence policy, no replication, and an unspecified behavior on `XADD` failure. Fix: AOF persistence, a documented degradation contract (a stream-publish failure must never fail the underlying write, since Postgres remains authoritative — publishing is best-effort with a full-refetch fallback), and a Redis-down scenario in the load test.
- **I9. No application-wide observability.** The only instrumentation in 8 phases is AI-specific cost metering and a basic DB health check — no error tracking, no APM, no external uptime monitoring, no alerting, no structured logging. Fix: structured logging with a trace ID convention, error tracking, external uptime monitoring against the readiness endpoint, and a golden-signals dashboard (SSE connection count, Redis stream lag, DB pool utilization, p95 latency, active-draft count).
- **I10. No connection-pool sizing methodology, no PgBouncer, no read replicas.** As autoscaling is added, connection demand scales with instance count in exactly the scenario (Sunday load) where scaling out is needed most — so the system could fail hardest exactly when trying to respond to load. Fix: PgBouncer in transaction-pooling mode, an explicit sizing formula recorded as a decision, a separate small pool for batch jobs so they can't starve the request path. Read replicas: deliberately deferred, the cache layer (I6) should absorb read-heavy paths first — record the revisit trigger rather than leaving it unmentioned.

## MINOR

- Redis Streams retention (`MAXLEN`) is unquantified — should be derived from the load test's measured peak event rate, not guessed.
- No pagination convention for chat history, dispute queues, or audit trails.
- No staging environment is ever provisioned, despite Phase 8 requiring one for its go-live integration test.
- The two-SSE-client test should be parameterized by client count now, so it scales to N=1000 later without a rewrite.
- AI cost-anomaly alerting is log-lines-only; route it into the real alerting path once real billing exists.

## Already well-handled

Redis Streams + SSE is the right shape for this traffic profile (the fix is to the specific mechanics, not the architecture). The double-entry, append-only, integer-cents payment ledger is correctly designed. The AI budget guard enforced before the provider call, and the hard rule that mechanical auto-pick never awaits the LLM, are both right. The fail-closed state-enablement gate is correct compliance design. The adapter-interface pattern used throughout for banking/KYC/sanctions/data is the right call.

## Suggested application order

1. Stream mechanics fix (C3) — everything downstream reads `docs/conventions.md`
2. Durable draft state (C4) — nothing else about horizontal scaling matters until this lands
3. Data layer: indexes, rollups, pooling, locking (C5, I10, I1)
4. Backups/DR + observability (C6, I9) — before real money exists, not after
5. Live-scoring pipeline + caching (C1, I6) — same design problem, build together
6. Scaling mechanics, edge protection, CDN (I5, I7, I4)
7. Load test (C2) — last, as the proof; re-run as a Phase 8 gate
8. AI cost control, batch-job scale (I2, I3) — independent, can proceed in parallel
