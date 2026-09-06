# Kicker and Team Defense Projections

**Status:** design, awaiting founder review. Founder ruling 2026-09-05: measured projection first ("2"), not market order.
**Author:** Claude, from the founder's ask "we also need to add K and D/ST to our board and draft picks".
**Groundwork:** every fact below about the current code is from the 2026-09-05 exploration report; every fact about the source is from the source's own release listing, checked the same day.

## 1. Goal

Kickers (K) and team defenses (DEF) get preseason projections from the same engine, under the same held-out discipline, as the four skill positions. They appear on the Draft HQ board with points, a range, a tier and a value over replacement; autopick fills their roster slots; the peek and full page render what is known about them and nothing that is not.

## 2. Non-goals for this round

- Field-goal distance scoring. The scoring shape carries one flat field-goal weight and the current-season feed has no distance buckets. The history does carry buckets, so the ingestion stores them, but no scoring preset changes in this round.
- Written analysis (capsules) for K and DEF. The Read card renders its honest absence. A later round decides what a kicker's write-up should even say.
- Discovery laws for K and DEF. The law vocabulary is built from skill-position facts and none of it transfers.
- Any change to QB, RB, WR or TE output. Gate G4 below makes this a hard guarantee.

## 3. What exists and what does not

Exists and is reused unchanged:

- In-season scoring already handles both positions end to end: the feed maps kickers (spelled PK upstream) and mints one synthetic DEF per team (`DST-<code>`), and `computeFantasyPoints` applies field goals, extra points, sacks, interceptions, fumble recoveries, defensive touchdowns, safeties and the points-allowed and yards-allowed tier tables.
- Value over replacement, tiers (the games-worth rule), the board service, the board's K and DEF tabs, and autopick's need scoring are all position-generic. Given projection rows they work without a branch.
- Game scores by team and week are already ingested from the schedule file, so points allowed exists historically.

Does not exist:

- Historical kicking and team-defense statistics. The current ingester reads none of the kicking columns and deliberately refuses the per-person defensive columns (a linebacker's sacks are not a team stat). The source publishes both quantities in the right shape: per-player weekly lines with kicking fields (1999 to 2025) and team-level weekly defense lines (1999 to 2025).
- A team-code crosswalk. The product spells two clubs LAR and WSH; the source spells them LA and WAS, and carries historical codes (STL, SD, OAK) the existing team-eras module already understands.
- Kicker identity. 0 of 71 kickers are in the player crosswalk; the crosswalk inputs stop at skill positions. Team defenses have no historical-universe row at all, and the projection store's foreign key requires one.
- Any fitted prior for either position. The fit tables carry neutral K and DEF cells that no observation has ever reached, because one gate, `projectedPosition`, drops everything that is not QB, RB, WR, TE.

## 4. Approaches considered

1. **Measured composition under the league's own scoring** (chosen). Season points = expected games × expected points per game, where points per game is computed by running per-game component expectations (attempts, make rates, sacks, takeaways, the points-allowed and yards-allowed distributions) through `computeFantasyPoints`. Components are shrunk toward the league mean by weights fit on history. Same architecture as the skill positions, same harness, same gates.
2. **Direct regression of fantasy points on prior-season fantasy points.** Simpler, but it bakes one scoring preset into the model, and a league with different defense tiers or a field-goal miss penalty would get a projection built for someone else's rules. Rejected: the engine's whole claim is that a projection is composed through the league's real scoring.
3. **Market order** (ADP) for both positions, permanently or as the ship path. Rejected by the founder as the primary, retained as the honest fallback for any position that fails its gates.

## 5. Architecture

Three phases, each its own plan. Phase B is a preregistered research round and may fail honestly; Phases A and C do not depend on it passing.

### Phase A: data and identity

**New source assets.** Two releases from the source we already use, regular season only, 2013 to 2025:

- Per-player weekly lines (`stats_player_week_<season>`), kicking columns only: field goals made, attempted, missed, blocked, made and missed by distance bucket (0-19, 20-29, 30-39, 40-49, 50-59, 60+), extra points made, attempted, missed, blocked. Kickers are rows whose position is K. Stored in `nflverse_kicking_weeks`, keyed by season, week, player id (gsis), team.
- Team weekly lines (`stats_team_week_<season>`): sacks, interceptions, opponent fumbles recovered, defensive touchdowns, safeties, blocked punts, extra points and field goals, special-teams touchdowns, and each team's own passing and rushing yards. Stored in `nflverse_team_defense_weeks`, keyed by season, week, team. Yards allowed is computed at ingest as the opponent's row's passing plus rushing yards, so the stored line is already in the team-defense frame. Points allowed joins from the schedule observations already stored.

Both ingesters follow the injuries and roster-weeks pattern: explicit column allowlist, `assertShape` that refuses a file missing a column rather than coarsening, idempotent COALESCE upsert, seasons ingested as a job with a backfill script, never a cron.

**Team codes.** One module, `src/projections/nflverse/team-codes.ts`, owns the product-to-source mapping (LAR to LA, WSH to WAS, identity otherwise) and composes with team-eras for historical codes. Nothing else declares a team list. The two existing product-spelling lists are pointed at it.

**Identity.** Kickers join the player crosswalk through the existing ESPN-id method; the crosswalk inputs widen from skill positions to K. Team defenses get 32 synthetic rows in the historical universe, id `team-def:<source code>`, position DEF, with a crosswalk row of a new method `team_defense` linking each to the product's `DST-<product code>`. The crosswalk's current unconditional "not an NFL player" answer for DEF becomes this deliberate mapping. Reason: the projection store's foreign key and every reader already join through the crosswalk, so this is the path of least surgery and no reader changes.

**Kicker job.** The week-one roster table already ingested says which kicker each team carries. That is the availability and opportunity anchor for a kicker the same way a depth chart is for a back.

### Phase B: the model, preregistered

Written as `docs/research/<date>-kicker-defense-preregistration.md`, dated the day it is written, before any fit, in the standing structure (blocked on, hypothesis, features, fit and judgment, gates, decision rule, UX rider, amendments).

**Composition.** For each candidate: expected games (availability prior; kickers rarely miss, defenses never do, so this is near 17 and the fit will say so) × expected points per game under the league's rules.

**Kicker components per game:** field-goal attempts, field-goal make rate, extra-point attempts, extra-point make rate. Attempts are a property of the team's offense and travel with the team; make rates travel with the kicker. Each component is a shrinkage blend: the kicker's own recent seasons (recency-weighted), the 2026 team's recent seasons, and the league mean, with the blend weights fit. A kicker with no history (rookie, first-year starter) gets team opportunity and league-mean make rates, stated as such.

**Defense components per game:** sacks, interceptions, fumble recoveries, defensive touchdowns, safeties, and the per-game distributions of points allowed and yards allowed. Because the tier tables are nonlinear, the expected tier points are computed as the average of the tier function over the team's recent per-game distribution, shrunk toward the league distribution, never the tier of the average. Team quality enters through prior-season point differential, the one team-level signal we hold historically; if a season-win-total market ever lands in the harvest it is a named amendment, not a quiet addition.

**Distribution.** Per-game variance is fit for both positions (`VARIANCE_POSITIONS` gains K and DEF) so the floor, median and ceiling band means what it means for a receiver. These are the two most volatile positions in the game and a games-only band would understate them.

**Fit and judgment.** Fit on 2013 to 2024. Judge on 2025 exactly once. 2026 stays pristine. Baselines: (1) last-season points order, (2) market ADP order on the ADP-covered subset, (3) the league mean (a flat board).

**Gates, all must pass, per position:**

- G1 Ordering. Spearman of model rank against 2025 actual season points beats the last-season-order baseline by at least 0.05.
- G2 Market. On the ADP-covered subset, the model's Spearman is no worse than the ADP baseline by more than 0.02.
- G3 Calibration. The "most seasons" band (p25 to p75) covers between 40% and 60% of 2025 actuals.
- G4 Isolation. The QB, RB, WR, TE rows of the 2025 judgment board are byte-identical before and after the change.

**Decision rule.** A position that passes ships as projected rows. A position that fails ships in market order, labeled as market order on the board (no projected points, no tier), with the failure recorded in the results document and the register. The founder chose measured-first; the fallback is what keeps rosters fillable if the measurement says no.

### Phase C: the product surface

- **Pipeline gate.** `projectedPosition` recognizes K. Team defenses are built by a separate candidate builder from the 32 synthetic universe rows, since no person-shaped source row exists. `FITTED_POSITIONS`, `VARIANCE_POSITIONS` gain both; `CURVE_POSITIONS` (rookie curves) does not.
- **Board.** Rows flow through the existing value and tier machinery. The games-worth tier rule applies unchanged; its share-based break is what lets a low-scoring position tier on its own scale.
- **Autopick.** A full-draft test asserts that under the standard roster every seat finishes with its K and DEF slots filled and that neither position is taken before the final two rounds unless every other starting slot is already filled. The rounds-from-the-end number is a named policy constant in `AUTOPICK_CONFIG`, rides the START_DRAFT snapshot like `surplusDamp`, and is absent-means-old-behavior for replay. This ships regardless of Phase B's outcome (the UX rider).
- **Peek and page.** The call card, range rail and season strip render from the same adapters. The role module gets a K variant (attempts per game, make rate, the team's kicking opportunity) and a DEF variant (sacks and takeaways per game, the points-allowed tier mix). The Read card renders absence. The story module renders absence. No number appears without its basis.
- **Copy.** No em-dashes, no semicolons, no competitor names, no tips. "Team defense" and "kicker" in full on first use per surface.

## 6. Data flow

Source release → ingester (shape-asserted, allowlisted) → observation tables → candidate builders (kicker via crosswalk, defense via synthetic universe row) → component fits → composition through `computeFantasyPoints` under the league's rules → `preseason_projections` rows → board service (value, tiers) → board, autopick snapshot, peek.

## 7. Error handling

- A source file missing an allowlisted column fails the ingest loudly. Nothing coarsens.
- A kicker who cannot be crosswalked gets no projection and appears on the board in market order only, labeled. The count of such kickers is reported by the ingest job.
- A defense whose product code has no source code is a startup error in the team-codes module's own test, not a runtime surprise.
- A league that starts no K or DEF (custom roster) gets no rows for that position, which is the existing replacement-level behavior.

## 8. Testing

- Unit: both ingest mappers against fixture rows including the yards-allowed opponent join and every distance bucket; team-codes round trip for all 32 plus the three historical codes; crosswalk method for defenses; candidate builders; composition through the tier function on a known distribution (a fixture where the tier of the mean and the mean of the tiers differ, asserting the latter).
- Harness: `scripts/preseason-report.ts` extended to report K and DEF alongside the four, with the three baselines. The 2025 judgment run is the preregistered single judgment.
- Autopick: the full-draft roster-completion test above, plus a replay test that an absent policy field reproduces the old behavior byte for byte.
- Design guards and the copy scan on every new string.
- E2E-lite: the board's K and DEF tabs render rows with a projected value and a tier band for a seeded league, or the market-order label if the position fell back.

## 9. Delegated decisions already made

- Synthetic universe rows for defenses rather than a parallel projection store.
- Regular season only for both history tables.
- Distance buckets stored now, scored later.
- Autopick late-round policy as a snapshot-versioned constant.

## 10. Open items for the founder

None required to start Phase A. Phase B's preregistration is a document the founder can read before the single judgment run.

## 11. Plans

Three plans under `docs/superpowers/plans/`, each dated the day it is written:

- `kdef-phase-a-data-identity` (ingestion, team codes, kicker crosswalk, synthetic defense rows)
- `kdef-phase-b-model-round` (opens with the preregistration document, closes with the single judgment)
- `kdef-phase-c-product-surface` (pipeline gate, board rows, autopick policy, peek variants)

Phase A and Phase C's autopick policy can start together. Phase C's board rows wait on Phase B's decision.
