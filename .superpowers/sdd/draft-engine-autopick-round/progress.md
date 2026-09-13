# Draft engine round: the clock's pick, the advisor's call, the must-pick line (2026-09-12)

Worktree `worktree-agent-a56da2a5443b84823`, cut from main at 67def3c9 (includes 6ad54a19). Founder report from real mock drafts: (1) the clock's pick drafts too many quarterbacks, (2) tiers are over-prioritised and a tight end goes too early, (3) a roster full except K and D/ST reads "no room on your bench for X" instead of "your next pick must be one of K, D/ST".

## Phase 1: measure, before any change

Harness: `scripts/clock-pick-measure.ts` (first committed as `autopick-measure.ts`; renamed so no printed line carries forbidden vocabulary). Command, from the worktree with `.env.local` copied in:

```
dotenv -e .env.local -- tsx scripts/clock-pick-measure.ts --runs 200 --advisor-runs 200
```

Defaults: seed 20260912, sharpness 0.5 (the room simulator's "mixed" market jitter), 12 teams, STANDARD_ROSTER_SLOTS (15 rounds, bench 6; `--bench 7` gives the 16-round shape). Board: `players.adp` ascending, 523 players (QB 57, RB 140, WR 178, TE 81, K 35, DEF 32), the exact order `rankedPlayers` snapshots into a real room. Evidence board for the advisor: `evidencePoolFor(db)`, 519 projected rows, generation 2026-09-09T00:25:38Z, positions QB/RB/WR/TE only (K and D/ST ship in market order per the 2026-09-05 ruling and are absent from the valued board). Every pick goes through the real engine (`submit`, `@/draft-service/sim/run`). Run 0 of each shape is the exact board; runs 1 to 200 jitter the market with the seed, because the clock's pick carries no RNG and 200 drafts of one fixed board would be 200 copies of one draft. Dev database only.

Four shapes: (1) every seat picked by the clock policy (`bestAvailableFor` under the START_DRAFT snapshot of `AUTOPICK_CONFIG`); (2) the incident shape, eleven practice bots and one clock-picked seat, rotating; (3) one seat following the advisor's call (`recommendNow`) among eleven clock-picked seats; (4) the founder's own setting, one advisor-led seat among eleven practice bots. Full output: scratchpad `measure/before.md` (before), `measure/after.md` (after).

### Before

Shape 1, 201 drafts, 2,412 team-drafts:

| Pos | mean/team | room first rd | ADP rd | team 1st rd | team 2nd rd | team 3rd rd | picks off board order |
|---|---|---|---|---|---|---|---|
| QB | 2.11 | 2.9 | 2.9 | 5.4 | 10.1 | 12.3 | 83.5% |
| RB | 4.32 | 1.0 | 1.0 | 2.4 | 4.5 | 7.7 | 53.7% |
| WR | 4.90 | 1.0 | 1.0 | 1.6 | 3.3 | 5.8 | 1.6% |
| TE | 1.67 | 2.0 | 2.0 | 6.1 | 11.5 | 13.0 | 85.0% |
| K | 1.00 | 14.0 | 15.0 | 14.8 | none | none | 1.5% |
| DEF | 1.00 | 11.3 | 12.8 | 13.5 | none | none | 40.8% |

| Teams holding | shape 1 (all clock) | shape 2 (clock seat among bots) | shape 3 (advisor among clock) | shape 4 (advisor among bots) |
|---|---|---|---|---|
| 3 or more QB | 12.1% | 46.8% | 21.9% | 82.6% |
| 2 or more QB | 99.0% | 99.0% | 100% | 100% |
| 2 or more TE | 66.6% | 99.0% | 100% | 100% |
| 3 or more TE | 0.1% | 48.8% | 91.0% | 97.0% |
| K before round 13 | 0.0% | 0.0% | 0.0% | 0.0% |
| D/ST before round 13 | 16.8% | 65.2% | 0.0% | 0.0% |

Advisor turns (3,015 per shape): the call differs from the highest roster-fit candidate in 33.9% (shape 3) and 30.4% (shape 4); of those, the call carries a tier cliff the value leader lacks in 7.1% and 9.8% of turns; the call's leading reason is the tier cliff in 8.9% and 0.9%; the call's expected value is exactly 0 (a tie broken by player id) in 19.1% and 13.8%; the shortlist is empty with roster slots still open in 13.3% of turns, all of them rounds 14 and 15 (only K and D/ST left). Tier-drop flips in the clock's pick: 0 by construction, there is no tier term in `bestAvailableFor`.

### Root causes, one sentence each

1. Quarterbacks: `needMultiplier` counted surplus over dedicated starters only, so a third back who would start in the flex scored as a surplus body and every further back or receiver compounded down as hard as a second quarterback, until by the late rounds a fifth back scored 0.6 x 0.25^4 while a second quarterback scored 0.6 x 0.25 and a third 0.6 x 0.25^2, and board order did the rest; the advisor stacked them for a different reason, its bench insurance valued any body by his own value over replacement and quarterbacks and tight ends are the positions whose deep players keep a positive one.
2. Tiers: no scoring in the product carries a tier-drop bonus; the tier cliff is a label the card leads with, and what the founder saw as tier chasing is two things, the two-turn survival term preferring a scarce bench body over a starter it can get back (7 to 10% of advisor turns, argued on the card by his tier) and the late-round tight-end pile-up (rounds 8, 10 and 12) from zero-value ties broken by player id and insurance paid to a third tight end who could not start even with the first one out.
3. K and D/ST: the valued board carries no kicker or team defense, so with the bench full `recommendPick` had nobody to rank, the card went dark, the dock fell back to the best skill player left on the board, and the engine refused him with `assignSlot`'s own words ("Your roster has no open slot for a WR"), which the room printed as "X did not land. ... You are still on the clock."

## Phase 2: the fix, tests first

Ruling: roster-need ceilings from the slot config, not a dial per position. `positionCeiling` = dedicated starters + shared slots he may fill + bench allowance; the bench is split among the flex positions in proportion to their dedicated starters (six over RB 2, WR 2, TE 1 gives 2, 2, 1), one backup at a position no flex takes (QB in a 1-QB league), none at K or D/ST. Standard shape: QB 2, RB 5, WR 5, TE 3, K 1, DEF 1 (sum 17 over 15 slots, a test pins that the sum covers every shipped shape). Why: the founder's numbers are a roster shape's numbers, and a longer bench should widen them without a deploy. Cost if wrong: a league with an odd shape gets a cap that binds where a manager would not; the fallback still returns a pick, never a stall.

Ruling: the clock's need term (snapshot field `rosterCeilings`, F3 discipline: absent replays the surplus-damp scoring byte for byte). A candidate who would START is warm per open starting slot he could fill, the flex included; one who would SIT is cooled to `startersFilledDamp` and again by `surplusDamp` per body already sitting at his position; a body over the ceiling is capped; a backup at a backup-only position waits while any starter is open. Why: "the second comes late and only when value justifies it" is exactly deferral plus board rank among bench bodies. Measured on the way: a flat bench damp with no compounding lifted three-TE teams from 0.1% to 10.7%, so the compounding stayed (it is the `surplusDamp` dial, now counting bench bodies rather than bodies over dedicated starters).

Ruling: the advisor keeps its two-turn expected value, gains the same ceilings and the same wait-for-starters rule, and its bench insurance becomes marginal: the share applies to what the candidate adds with the best man at his position out, so a body who still could not start insures nothing; ties in expected value break by fewer bodies already sitting at the position, then the market's order, never the player id. `BENCH_DEPTH_DECAY` retired.

Ruling on the tier bound: there is no tier bonus to bound in the score. The tier argument is bounded on the card instead: `buildWhy` argues a cliff only for a pick that fills a starting slot; a bench body is argued by his rank and the spot he takes. Why: a drop behind a bench body is a fact about the board, not a reason to take him. Cost if wrong: a bench body who really is the last of his tier loses that sentence.

Ruling on copy: one domain sentence, `mustPickLine` ("Your next pick must be a K or a D/ST."), from one domain rule, `restrictedPositions` (null while a bench spot is open or while every position the league rosters still fits, else the open starting slots' positions in slot order). Said by the engine's refusal (`applyPick`), the advisor's card (sentence one, shape `must:0`), the clock's notice (`draft_auto_picked` with `mustPick`), and the dock, whose fallback now only names a player the roster can take. The advisor's shortlist falls back to the board's own order among the owed positions, so K and D/ST stay in market order. `positionLabel` gives D/ST its one spelling.

Not changed: the practice bots' sampler and archetypes (the opponent model infers from that sampler; retuning it re-deals in-flight seeded rooms), replacement levels, the K and D/ST ruling, `surplusDamp` and every other dial's value.

## Phase 3: after (same command, same seed)

Shape 1, 201 drafts, 2,412 team-drafts, before then after:

| Pos | mean/team | room first rd (ADP rd) | team 1st rd | team 2nd rd | team 3rd rd | picks off board order |
|---|---|---|---|---|---|---|
| QB | 2.11 to 2.00 | 2.9 to 2.9 (2.9) | 5.4 to 5.6 | 10.1 to 10.2 | 12.3 to none | 83.5% to 40.5% |
| RB | 4.32 to 4.51 | 1.0 to 1.0 (1.0) | 2.4 to 2.6 | 4.5 to 5.0 | 7.7 to 7.7 | 53.7% to 43.1% |
| WR | 4.90 to 4.82 | 1.0 to 1.0 (1.0) | 1.6 to 1.7 | 3.3 to 3.7 | 5.8 to 5.7 | 1.6% to 9.9% |
| TE | 1.67 to 1.67 | 2.0 to 2.0 (2.0) | 6.1 to 6.5 | 11.5 to 11.2 | 13.0 to 11.0 | 85.0% to 73.2% |
| K | 1.00 to 1.00 | 14.0 to 14.0 (15.0) | 14.8 to 14.8 | none | none | 1.5% to 0.1% |
| DEF | 1.00 to 1.00 | 11.3 to 12.0 (12.8) | 13.5 to 13.7 | none | none | 40.8% to 35.2% |

Three columns per cell: before, after the first fix (`measure/after.md`, 200 runs every shape), after the founder's bench-allowance ruling (`measure/after-ruling.md`, same seed, 200 runs for shapes 1 and 2, 100 advisor runs for shapes 3 and 4, the foreground timeout's bound).

| Teams holding | shape 1 (all clock) | shape 2 (clock seat among bots) | shape 3 (advisor among clock) | shape 4 (advisor among bots) |
|---|---|---|---|---|
| 3 or more QB | 12.1% / 0.0% / 0.0% | 46.8% / 0.0% / 0.0% | 21.9% / 0.0% / 0.0% | 82.6% / 0.0% / 0.0% |
| 2 or more QB | 99.0% / 100% / 100% | 99.0% / 98.5% / 99.0% | 100% / 100% / 100% | 100% / 100% / 100% |
| 2 or more TE | 66.6% / 64.5% / 66.7% | 99.0% / 97.5% / 97.5% | 100% / 100% / 100% | 100% / 100% / 100% |
| 3 or more TE | 0.1% / 2.3% / 0.0% | 48.8% / 35.8% / 0.0% | 91.0% / 6.5% / 0.0% | 97.0% / 61.2% / 0.0% |
| K before round 13 | 0.0% / 0.0% / 0.0% | 0.0% / 0.0% / 0.0% | 0.0% / 0.0% / 0.0% | 0.0% / 0.0% / 0.0% |
| D/ST before round 13 | 16.8% / 8.5% / 8.5% | 65.2% / 26.9% / 27.9% | 0.0% / 0.0% / 0.0% | 0.0% / 0.0% / 0.0% |

Bench depth per team, before / after / after-ruling: shape 1 RB 4.32 / 4.51 / 4.50, WR 4.90 / 4.82 / 4.83; shape 2 RB 3.93 / 4.24 / 4.38, WR 3.81 / 4.44 / 4.65; shape 3 RB 3.03 / 4.21 / 4.27, WR 4.78 / 4.73 / 4.73; shape 4 RB 2.41 / 4.08 / 4.30, WR 4.24 / 4.31 / 4.70. Said plainly: RB and WR depth moved by more than 0.2 a team in shapes 2, 3 and 4 (RB up 0.45, 1.24 and 1.89; WR up 0.84 and 0.46 in shapes 2 and 4). Those are the bench spots the third quarterback and the third and fourth tight ends used to take; shape 1 moved 0.18 and 0.07. The room-level first-TE round is 2.0 in every shape and every column, on its ADP round of 2.0; team-level first TE 6.1 / 6.5 / 6.4 in shape 1.

Ruling (founder, 2026-09-12, after the first re-measure): the positions a league starts one of (QB, TE, K, D/ST) hold at most one bench body each, so a team holds at most two of any of them regardless of shape, none at K or D/ST; that backup waits for the starters like the second quarterback; the rest of the bench goes to RB and WR in proportion to their starting slots including the flex. Standard: QB 2, TE 2, RB 5, WR 5, K 1, DEF 1 (sum 16 over 15). Sixteen-round: RB 6, WR 6. Superflex: QB 2, RB 6, WR 6. Pinned per shape in `roster-need.test.ts`. Commit 6dcd1e00.

Advisor turns after (3,015 per shape before the ruling, 1,515 after): empty shortlist with slots open 13.3% / 0.0% / 0.0% (shape 3) and 13.3% / 0.0% / 0.0% (shape 4); rounds 14 and 15 now name a K or a D/ST on every turn. The call differs from the highest roster-fit candidate in 40.1% (shape 3), the call's leading reason is the tier cliff in 5.0% (from 8.9%), the tier-cliff flip share is 8.0% (from 7.1%), and exact zero ties are 33.8% (from 19.1%), now ordered by bench depth then ADP rather than player id (more ties because a body who cannot cover an injury is worth exactly nothing). The advisor-led seat's roster: QB 2.00 (from 2.22), RB 4.21 (from 3.03), WR 4.73 (from 4.78), TE 2.06 (from 2.97); first TE at 7.6 (from 7.8, ADP round 2.0).

Acceptance, against the brief: three-QB teams go to zero in every shape. The first-TE round is unchanged at the room level (2.0, on its ADP round) and moves 6.1 to 6.5 at the team level, a shift of 0.4 away from ADP in shape 1 and 0.2 toward it in shape 3, within the one-round bound and not an overshoot. No position's room-level first-taken round moves away from ADP by more than a round: QB, RB, WR, TE and K are unchanged, D/ST moves 11.3 to 12.0 toward its ADP round 12.8.

What got worse after the first fix, and what the ruling did about it: three-TE teams in shape 1 rose 0.1% to 2.3% under the first ceilings (TE 3 allowed) and are 0.0% in every shape under the ruling (TE 2). Still true after the ruling: every clock-picked team holds exactly two quarterbacks (the second at round 10.2, after the starters, by board rank against the bench back or receiver) and 67% to 100% hold two tight ends; "picks off board order" for WR rose 1.6% to 10.2% because a fourth receiver is now a bench body cooled like every other. The lever left is `surplusDamp` (per-bench-body compounding), not moved.

Coverage: `src/draft-engine` runs alone at 99.54 / 98.68 / 99.39 / 99.62 (statements / branches / functions / lines); every file this round touched is at 100, the two remaining lines (`auction.ts:65`, `selectors.ts:471-472`, `isPaused`) are untouched and reached by `src/draft-service` tests in the full suite.

## The practice bots (founder ruling, 2026-09-12, after the first report)

Ruling: the bots draft under the same roster-need ceilings and the same wait-for-starters rule as the clock, riding the same START_DRAFT snapshot (`state.config.autopick.rosterCeilings`): a room started before the deploy carries none and its sampler replays byte for byte (pinned: the legacy room's weights equal the brain with the ceilings set aside); a room opened after draws from a window that leaves out a capped body and, while a starter is open, the one backup at a single-starter position, with a bench body cooled by the bots' own `benchBodyDamp` per body already sitting. One role reader (`candidateRoleReader`, `roster-need.ts`) classifies a candidate for the clock, the bots and the advisor. Headless sims (`sim/run.ts`) stamp the snapshot too.

Measured, shape 2 (eleven bots, 201 drafts, 2,211 bot seats), legacy snapshot then current: three or more QB 27.4% to 0.0% (the legacy histogram ran to seven quarterbacks on one seat), three or more TE 11.8% to 0.0%, two or more QB 60.4% to 90.5%, two or more TE 41.3% to 65.8%, D/ST before round 13 2.1% to 10.9%. Bots' room-level first-taken rounds against ADP: QB 2.6 to 2.7 (2.9), RB 1.0 (1.0), WR 1.0 (1.0), TE 1.8 (2.0), K 13.9 to 13.8 (15.0), D/ST 12.1 to 11.9 (12.8), every one within a round. Bench depth per bot: RB 3.95 to 4.09, WR 4.58 to 4.43. Shape 4 (advisor among bots, 101 drafts): three or more QB 0.0%, three or more TE 0.0%, TE 2.00, QB 2.00, RB 4.26, WR 4.74, first TE 6.6 (ADP 2.0), D/ST 14.1 (12.8). Commands: `--snapshot legacy --advisor-runs 0` for before, the default for after; outputs `measure/bots-legacy.md`, `measure/final.md`.

The opponent model (`seat-model.ts`): the likelihood of a pick under a brain now reads the room's need shape with the policy's exclusions set aside (`enforce: false`), so a human who takes a second quarterback early is scored at his bench-body weight and still reads as qb_early (pinned), while a bot's picks keep the shape they were drawn under. Read back on the bots' own dealt brains at the end of the same 200 drafts, before then after: read correctly 25.6% then 17.1%, still on the prior 33.0% then 45.8%, read as another brain 41.3% then 37.1% (entering round 6: 15.6% / 52.8% / 31.6% then 14.0% / 53.4% / 32.6%). Said plainly: the read is less often right and more often on the prior, because the ceilings make the seven brains draft more alike (every bot ends with two quarterbacks and two tight ends, and the archetypes had expressed themselves in exactly the stacking the ruling forbids); it is less often wrong. The brain-only variant (`ceilings: null`) was measured first and read worse (13.2% right), so it was not kept. Pinned in `seat-model.test.ts` as a floor and a ceiling over twenty seeded drafts, never the exact numbers. `SEAT_MODEL_CONFIG` thresholds unchanged.

Two hazards met on the way, recorded rather than fixed: (1) the snapshot field's name and rule are load-bearing from the first deploy on: within this un-deployed session the rule under `rosterCeilings` changed twice, and rooms my first e2e build had started replayed under the later rule to "already drafted" (three dev mock rooms of mine, deleted); from the first deploy on, a further change to the rule rides a new field. (2) Any second process that ticks the same draft from its own cache (an orphaned `next-server` from a previous Playwright run, two were found and stopped, or a test's own store writes) lets a later pick name an already-drafted player and leaves the log unreplayable; the ceilings spec therefore posts the host's picks through the room's own route so the running server applies them.

## Gates

- `npx tsc --noEmit -p .`: clean.
- `npx eslint src/domain src/draft-engine src/draft-service src/projections/decide src/draft-room src/integrity scripts/clock-pick-measure.ts`: clean.
- vitest lane set (`src/domain src/draft-engine src/draft-service src/mock-draft src/mock-draft-service src/draft-room src/draft-hq src/projections/decide src/integrity`): 212 files, 3,634 tests, 3 pre-existing failures in `src/draft-service/api-routes.test.ts` (ShareLinkPanel data, MOCK_COPY countdown, advance-on-read; `ECONNREFUSED 127.0.0.1:3000`), reproduced identically at 67def3c9 in a temporary `git worktree add` on the dev lane (`npx vitest run src/draft-service/api-routes.test.ts`: 3 failed, 26 passed there too). The two failures that were mine (the store notice body in a bench-less fixture, the script-copy rule on the word "autopick") were fixed and re-run: 59 files, 726 tests green on the affected suites.
- Playwright, e2e build, own port 3187: `e2e/assistant-tab.spec.ts` 1 passed, `e2e/draft-room-sideline.spec.ts` 2 passed.

Gates after the bots ruling (commit 3c42c8c3): tsc clean; eslint clean on `src/domain src/draft-engine src/draft-service src/mock-draft src/mock-draft-service src/projections/decide src/draft-room src/integrity`, the harness and the three e2e files; `src/draft-engine` alone 372 tests, coverage 99.54 / 98.68 / 99.41 / 99.62 with every touched file at 100 (the two untouched lines as before). Playwright on the rebuilt bundle, port 3187: `mock-draft-ceilings.spec.ts` 1 passed (a twelve-team solo room drafted live to completion in 2.4 minutes, every bot within its ceilings, no clock pick in the log), `assistant-tab.spec.ts` 1 passed, `draft-room-sideline.spec.ts` 2 passed. `mock-draft.spec.ts` (whose helpers moved to `support/mock-room.ts`): both tests fail at the front-door URL and the share URL, before or apart from those helpers, and fail identically at 67def3c9 in a temporary `git worktree add` with its own e2e build on port 3188 (pre-existing). Lane-set vitest (`src/domain src/draft-engine src/draft-service src/mock-draft src/mock-draft-service src/draft-room src/draft-hq src/projections/decide src/integrity`): 212 files, 3,643 tests, 3,640 passed, the 3 pre-existing `api-routes.test.ts` failures only. One earlier lane run timed out `replay.test.ts`'s "shuffling it changes no pick" at its 15-second budget under load after the ceilings and cover made `recommendPick` costlier; the memo brought that test from 9.8 to 7.8 seconds alone and it passed in the final run.
