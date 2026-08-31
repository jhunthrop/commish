# Prediction Laws: play-caller facts, a measured law registry, and rankings that explain themselves

Date: 2026-08-31
Status: approved direction (founder delegated design calls; "full production solution end to end")
Owner: engine

## What this is

Three additions to the existing projection engine (`src/projections/`), in sequence:

1. **A sourced play-caller table** filling the one documented data hole in the coaching
   mechanism (`nflverse/coaches.ts` uses head coach from `games.csv` and states: "the day a
   sourced coordinator table exists it drops straight in").
2. **A law registry**: the folk wisdom of fantasy football ("RBs fall off at 30", "300 touches
   is a cliff", "beware the new alpha WR") turned into declarative claims, each MEASURED through
   the existing leakage-safe backtest on held-out seasons and stamped with a verdict —
   confirmed, weak, or debunked. Only confirmed laws adjust the model. Debunked laws ship as
   content, with the data that killed them.
3. **Explanation surfaces**: law-backed reasons on the draft board, the player card
   (PlayerPeek), and the pre-draft rankings, plus a public laws reference page in the
   `/league-rules` mold.

The bar for the whole round: the preseason board beats the ADP benchmark on held-out seasons
via the existing scorecard (`projections/metrics.ts`, benchmarks naive/ADP/ECR), reported
honestly either way.

## What already exists (and is NOT rebuilt)

- nflverse ingestion back to 1999: play-by-play, rosters, schedules (`projections/nflverse/`).
- The leakage-safe backtest (`projections/backtest.ts`): as-of discipline, one read path
  (`statLinesAsOf`), scorecards vs naive/ADP/ECR (`preseason/benchmarks.ts`).
- The preseason board (`preseason/board.ts`) with structured `BoardReason` values — including
  an existing `new_play_caller` code — plus age brackets, career curves, availability, depth,
  rookies, VOR, tiers.
- The coaching mechanism (`nflverse/coaches.ts`): `COACH_METRICS` (tenure, prior pace, prior
  pass-rate-over-expected), name-indifferent by design.
- The model fit path (`model/fit.ts`, `model/compose.ts`) — confirmed laws flow through it,
  never around it.

## Part 1 — Play-caller facts

**Data.** `data/play-callers/play-callers.csv`, committed to the repo (facts, like fixtures):
`season, team, name, role, start_week, end_week, source, note`. Role is `HC` or `OC` — the
row records WHO CALLED THE PLAYS, which is sometimes the head coach; that judgment is the
one place assembly needs a human eye. Coverage 1999→present, all teams, midseason changes as
separate rows with week ranges.

**Sources & provenance.** Primary: the founder's paid PFR account, used through its interface
and Stathead exports at human request rates — never a crawler (phase-8 ledger entry,
2026-08-31 ruling). Cross-check: Wikipedia team-season infoboxes via the sanctioned MediaWiki
API (CC BY-SA). Every row carries `source`; disagreements are resolved by hand and noted in
`note`. Internal model use only; the names never render in the product.

**Validation.** An ingestion script (`scripts/ingest-play-callers.ts` pattern-matched to the
existing ingest scripts) validates shape (every team-season 1999→present covered exactly once
per week, week ranges partition the season, names non-empty), loads the store, and fails fast
on gaps. A test pins the validator against hand-broken fixtures.

**Wiring.** `coaches.ts` gains a play-caller-aware source: where the table has a row, the
play-caller's name feeds tenure/prior-pace/prior-PROE attribution (week-accurate, replacing
the "most frequent coach" heuristic for covered spans); where it does not, head coach remains
the honest fallback. `COACH_METRICS` names and the downstream mechanism are unchanged.
Before/after backtest runs on held-out seasons decide whether play-caller attribution replaces
head-coach attribution in the shipped model; the scorecard delta is recorded in the registry
(this is itself law L4's measurement).

## Part 2 — The law registry

**Module.** `src/projections/laws/` — registry, measurement harness, verdicts.

**A law is a value:**

```ts
interface Law {
  readonly id: LawId;                       // e.g. "rb_workload_cliff"
  readonly position: Position | "all";
  readonly claim: string;                   // the folk statement, plain words
  readonly measured: {
    readonly effect: number;                // points/game delta vs matched baseline
    readonly ci: readonly [number, number]; // 95% interval
    readonly sample: number;                // player-seasons
    readonly seasons: string;               // e.g. "2011–2024, held out 2023–2024"
  };
  readonly verdict: "confirmed" | "weak" | "debunked";
  readonly modelPath: string | null;        // fitted feature it gates, null if content-only
}
```

**Measurement discipline.** Every law is measured through the existing backtest reads (as-of
gated), on held-out seasons, against a MATCHED BASELINE — the 300-touch law is measured
against equally-productive seasons without 300 touches, so regression to the mean cannot
masquerade as a cliff (the board's own dead cliff-detector documented this trap; the registry
inherits the lesson). Verdict rules are mechanical: confirmed = CI excludes zero on held-out
data; weak = direction holds, CI spans zero; debunked = no effect or the matched baseline
explains it. Measurements are reproducible: `npm run laws:measure` re-derives every number in
the registry from the stores and fails if a committed figure drifts from the recomputed one.

**V1 laws (measured, whatever the verdicts turn out to be):**

- L1 `rb_workload_cliff` — RB seasons of 300+ touches decline the following year beyond what
  matched production alone predicts.
- L2 `rb_age_curve` — RBs decline from 27–28; measured per `AGE_BRACKETS`
  (`preseason/availability.ts`).
- L3 `wr_target_competition` — a new primary target arriving (or leaving) moves incumbent WR
  output; builds on the existing offseason share-redistribution features.
- L4 `play_caller_fingerprint` — pace and pass-rate-over-expected travel with the play-caller;
  positional usage under this caller predicts positional output. Enabled by Part 1.
- L5 `target_share_persistence` — prior-season target share predicts next-season output better
  than prior-season points.
- L6 `td_regression` — touchdown rate over expectation regresses.

**Model wiring.** The registry never forks the model. Confirmed laws map to fitted features
through the existing `model/fit.ts` path (`modelPath` names the feature); laws whose features
already exist (L2, L3, L4-adjacent) are annotations that gate and document them; a confirmed
law with no existing feature gets one through the normal feature/fit route. Debunked laws set
`modelPath: null` and appear only as content.

## Part 3 — Explanation surfaces

**Reasons.** `BoardReason` gains ONE law-backed variant:
`{ code: "law"; lawId: LawId; effect: number; magnitude: number }` — `effect` is the law's
registry-measured effect, `magnitude` is this player's exposure to it (e.g. his touches over
the threshold, his age, his caller's prior PROE). Reasons stay structured values; all copy
renders in the component (rendered-copy pattern). Rankings cite at most the two strongest
reasons per player (Sunday v5 law 4: spend emphasis once).

**Surfaces.**
- Draft room board (the pre-draft rankings surface): reason chips per player row.
- PlayerPeek: an "Outlook" section with the full reason chain and the measured figures.
- `/player-laws`: a public reference page in the `/league-rules` mold — every law, its claim
  in plain words, the measured effect, sample, seasons, and verdict, debunked laws included
  ("The 300-touch cliff: what the data actually says"). Every figure renders from the
  registry; nothing is typed into copy (Sunday v5 law 7). No em-dashes in user-facing copy;
  the page explains itself with no tips.

## Part 4 — The bar and the tests

- **The bar:** preseason board beats the ADP benchmark (`BENCHMARK_SOURCES.adp`) on held-out
  seasons on the existing scorecard. The scorecard result is committed to
  `docs/research/` with the round's close-out, beaten or not.
- **Engine tests (maintained, TDD):** validator tests on hand-broken play-caller fixtures;
  measurement-harness tests on synthetic populations with KNOWN planted effects (a planted
  cliff must be found; a planted regression-only population must yield "debunked");
  registry-drift test (`laws:measure` reproducibility); coaches.ts attribution tests for
  midseason spans and fallback.
- **UI tests:** deferred per the standing UX test ledger ruling; engine suites stay green
  serially.

## Sequencing

1. Play-caller CSV assembly + validator + ingestion (data first; everything else reads it).
2. Coaches wiring + before/after backtest (= L4 measurement).
3. Registry module + measurement harness + L1–L6 measured.
4. Model gating of confirmed laws + board reason chains.
5. UI surfaces + `/player-laws` page.
6. Scorecard vs ADP on held-out seasons; close-out doc.

## Out of scope this round

Rookie-specific college-data modeling (existing rookies.ts path stands), in-season weekly law
re-measurement, FAAB/auction valuation, any new database engine (facts live in Postgres like
everything else), displaying PFR-derived names in the product.
