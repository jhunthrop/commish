# ESPN engine gap analysis — 2026-08-30

Founder ask: walk a real logged-in ESPN league ("A League of Their Own", leagueId 1081607624,
12-team H2H PPR) and map where our fantasy engine is lacking. Sources: the players/add board,
league settings (the full rule sheet), team clubhouse glossary, standings. This is the ENGINE
side — rules, scoring, transactions, schedule — not visual design.

## 1. Scoring engine gaps (highest fidelity risk)

Our `ScoringRules` covers: pass/rush/rec yards + TDs, receptions, INTs thrown, fumbles lost,
FG made, XP made, sacks, DEF INTs, DEF TDs. ESPN's default sheet this league runs:

| Category | ESPN | Us |
|---|---|---|
| FG by distance | 0-39: 3, 40-49: 4, 50-59: 5, 60+: 6, missed: -1 | flat `fgMade`, no distance, no miss penalty |
| 2pt conversions | pass/rush/rec each 2 | absent (not scored, not harvested) |
| DEF points allowed | 7 tiers, 0 PA: +5 … 46+: -5 | **persisted since today** (`pointsAllowed`), not yet scored |
| DEF yards allowed | 8 tiers, <100: +5 … 550+: -7 | absent (needs total-yards harvest per DST) |
| DEF fumbles recovered / safeties / blocks / return TDs / 2pt returns / 1pt safety | all scored | absent |
| Player return TDs (KR/PR) + fumble-recovered TD | scored under Misc | absent |
| INT thrown | -2 here (configurable) | ours is configurable — fine |

The scoring engine's SHAPE is right (per-league `scoring_settings`); the stat vocabulary is the
gap. Most missing inputs are in the Tank01 box score (2pt conversions, return TDs, DST yards
allowed) — a mapper/StatLine widening plus scoring-rule fields.

## 2. Roster & lineup engine gaps

- **Per-game lineup locks.** ESPN: "Lock individually at Scheduled Gametime." Ours locks the
  whole week at first kickoff. This is the single biggest felt difference in-season: a Sunday
  4:25 player is swappable until 4:25. We now hold real kickoff times (`nfl_games`) — the
  engine change is per-slot lock evaluation instead of week-level.
- **IR slot** (16-man roster = 15 + 1 IR here). We have no IR concept; injury designations are
  now harvested, so eligibility ("only O/IR players sit in IR") is checkable.
- **Position maximums** (max 4 QB, 8 RB…). We have none.
- **Slot taxonomy**: ESPN supports TQB, WR/TE, RB/WR, OP (superflex), full IDP (DT/DE/LB/CB/S…),
  P, HC. We have QB/RB/WR/TE/K/DEF + FLEX/SUPERFLEX. IDP is a later market; OP we render already.
- **Future-week lineups**: ESPN sets any week ahead; we only expose the current week.
- **Lineup protection** (auto-swap inactive players): ESPN feature toggle; ours absent — the
  harvested inactives feed is the input.
- **Undroppables list**: platform-protected players can't be dropped. Absent.

## 3. Transactions engine gaps

- **Waivers.** Ours is FCFS-only (documented seam). ESPN default: waiver PERIOD (1 day),
  waiver ORDER (move-to-last-after-claim), scheduled process time, waiver report page, FAAB as
  an alternative system. This is the biggest missing subsystem in fairness terms.
- **Acquisition limits** (per-season cap), **trade limits**, **trade deadline**, **trade review
  period + league veto votes** (5 here), **eliminated-team transaction locks**. Our trades have
  proposals/acceptance + fairness sweep; no deadline, review window, or veto machinery.
- **Transaction counter** page (per-team season acquisition/trade tally). We have the audit
  chain — the data exists; no rollup.
- **Stat corrections page**: our correction sweep already re-settles weeks; ESPN surfaces the
  corrections to users. Ours is invisible.

## 4. Schedule / season structure gaps

- **Divisions** (+ clinch codes y/z/*, division tiebreakers). Absent.
- **Configurable season shape**: weeks-per-matchup, regular-season length, matchup tiebreakers,
  home-field advantage, bonus wins. Ours: fixed 1-week matchups, 14 weeks, no tiebreakers.
- **Playoff engine**: rounds with configurable lengths (2-week championship here), seeding
  tiebreakers, reseeding toggle, byes, **consolation ladder**. Ours: playoff cut + clinch flag;
  no bracket machinery at all.
- **Multi-season history**: standings selector back to 2023, League History page. Ours: one
  season, no archive concept.
- **Playoff odds + projected bracket** ("PLAYOFF %"): a projections product on top of the
  engine. Ours: none (engine work + our projections could do this honestly).

## 5. Research & market surfaces (engine-adjacent)

Columns/pages ESPN treats as table stakes: PROJ (weekly), OPRK, PVO, %ST, %ROST, +/- (roster
trend), PRK, LAST; pages for Scoring Leaders, Points Against (by position), Added/Dropped,
Live Draft Trends, Waiver Order/Report, Watch List. Notes:
- Weekly PROJ: harvested (`tank01_projections`) — surfaced today in the lineup grid.
- OPRK/PVO: computable from our real stat lines (position points vs each NFL team) — honest.
- %ST/%ROST/+/-: require platform scale; honest substitutes for now are ADP drift (harvested
  daily) and our own cross-league roster rate once league count grows.
- Watch list: pure product feature, no data dependency.

## 6. What we already match or beat

Per-league scoring reads on every surface (their glossary explains columns; ours self-explain),
event-sourced audit with hash chain (they have nothing user-visible like it), live claims with
serialized transactions, the advisor, our projections-vs-market-vs-experts strip, real
schedule/injuries/news harvests landing daily, and a modern lineup flow ESPN still doesn't have
(two-tap swap with both-ends eligibility lighting, autosave).

## 7. Suggested engine roadmap order

1. **Scoring vocabulary completion** — 2pt conversions, FG distance buckets + misses, DEF
   points/yards-allowed tiers, return TDs; widen StatLine + mapper (mostly in the box score
   already) and `scoring_settings`. Rescore is safe: correction sweep machinery exists.
2. **Per-game lineup locks** — kickoff times are in `nfl_games`; the week-level lock becomes
   per-slot. Unlocks the "Sunday morning scramble" experience.
3. **IR slot + undroppables + lineup protection** — all fed by the injuries/inactives harvest.
4. **Waiver system v1** — 1-day period + move-to-last order (ESPN's default), waiver report in
   Activity; FAAB as the follow-on. The claims seam was built for this.
5. **Trade governance** — deadline, review period, veto votes, eliminated locks.
6. **Playoff bracket engine** — rounds, byes, 2-week finals, reseeding, consolation; then
   playoff odds from our projections.
7. **Divisions + schedule configurability**; multi-season history at the first real rollover.
