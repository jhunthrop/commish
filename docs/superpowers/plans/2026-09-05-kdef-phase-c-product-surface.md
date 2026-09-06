# Kicker and Team Defense, Phase C — The Product Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kickers and team defenses appear on the Draft HQ board with points, a range, a tier and a value over replacement when Phase B's gates passed, or in market order with an honest label when they did not; autopick fills both slots and takes neither early; and the peek renders what is known about each and nothing that is not.

**Architecture:** One pipeline gate widens (`projectedPosition` learns `K`), one new assembly module builds both positions' candidates and hands them to the existing `shippedPreseasonCandidates` seam, and one committed decision constant carries Phase B's per-position verdict so the fallback path is a value rather than a branch somebody has to remember. The autopick policy is a snapshot-versioned constant in `AUTOPICK_CONFIG` that rides the `START_DRAFT` action exactly the way `surplusDamp` does, absent meaning the old behavior. Everything downstream of a candidate (value over replacement, tiers, the board service, the board's existing K and DEF tabs, autopick's need scoring) is already position-generic and gains no branch.

**Tech Stack:** Next.js App Router, TypeScript strict, Drizzle/Postgres, vitest, Playwright, the existing draft engine and preseason board.

**Spec:** `docs/superpowers/specs/2026-09-05-kicker-defense-projections-design.md` §5 Phase C, §6, §7, §8. Task 1 has no dependency on Phase B and ships regardless of its outcome (the spec's UX rider); Tasks 2 onward depend on Phase A being merged, and Task 4 onward on Phase B's judgment having been run.

## Global Constraints

- Honest data is absolute. A position that failed its gates renders in market order with no projected points and no tier, labeled as market order. Absence renders as absence. Never a number without its basis.
- **Gate G4 discipline.** Task 2 is the commit that can move a skill-position row. Before starting it, produce the "before" rendering with `npm run projections:kdef:judgment -- --season 2025 --isolation-emit /tmp/kdef-g4-before.txt`; after Task 4, produce the "after" and diff them. The diff must be empty.
- 2026 is never read by any fit. Nothing in this plan fits anything.
- No em-dashes, no semicolons, no competitor names and no tips in any user-facing string. "Team defense" and "kicker" in full on the first use per surface.
- Written analysis (capsules) stays absent for K and DEF: `isSkillPosition` (`src/projections/laws/populations.ts`) keeps its current gate, and `src/capsules/collect.ts` keeps reading it. The Read card renders its honest absence.
- No discovery law speaks for K or DEF. The law vocabulary is built from skill-position facts and `lawReasonsFor` already gates every law on the candidate's own position.
- Functions under 50 lines, files under 800 lines, immutability, explicit errors, no `any`.
- Gates after every task: `npx tsc --noEmit -p .`, `npx eslint <touched dirs>`, `npx vitest run <touched dirs>`, plus `npx vitest run src/design` on any task that touches a UI file.
- Commit messages carry a conventional type prefix and end with the two trailer lines:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS`.

## File map

- Modify: `src/draft-engine/config.ts` — `DraftAutopickPolicy.lateRoundOnlyRoundsFromEnd`, `AUTOPICK_CONFIG`
- Modify: `src/draft-engine/scoring.ts` — `LATE_ROUND_ONLY_POSITIONS`, `deferredLateRoundPosition`
- Modify: `src/draft-engine/selectors.ts` — `bestAvailableFor` honors the policy
- Modify: `src/draft-engine/full-draft.test.ts`, `src/draft-engine/replay.test.ts`
- Modify: `src/projections/nflverse/players.ts` — `projectedPosition` recognizes `K`
- Create: `src/projections/preseason/kdef-candidates.ts` (+ test) — loads both positions' history and builds their candidates
- Create: `src/projections/preseason/kdef-decision.ts` (+ test) — Phase B's verdict per position, and the market-order fallback candidate builder
- Modify: `src/projections/market/blend.ts` — `shippedPreseasonCandidates` appends the K and DEF candidates
- Modify: `src/projections/preseason/board.ts` — the `market_order_only` reason
- Modify: `scripts/preseason-report.ts` — K and DEF in the harness
- Modify: `src/league-room/outlook/groups.ts` (+ test) — the new reason codes render
- Modify: `src/league-room/lib/player-season-view.ts` (+ test) — a kicker's and a defense's season strip
- Create: `e2e/board-kdef.spec.ts` — the board's K and DEF tabs render rows

---

### Task 1: The autopick late-round policy

This task is independent of every other task in this plan and of Phase B entirely. It is the spec's
UX rider: whatever the measurement says, a seat must finish a draft with a kicker and a defense.

**Files:**
- Modify: `src/draft-engine/config.ts`
- Modify: `src/draft-engine/scoring.ts`
- Modify: `src/draft-engine/selectors.ts`
- Modify: `src/draft-engine/full-draft.test.ts`
- Modify: `src/draft-engine/replay.test.ts`

**Interfaces:**
- Produces:

```typescript
// config.ts
export interface DraftAutopickPolicy {
  // ... existing fields ...
  readonly lateRoundOnlyRoundsFromEnd?: number;
}
export const AUTOPICK_CONFIG: DraftAutopickPolicy = { /* ... */ lateRoundOnlyRoundsFromEnd: 2 };

// scoring.ts
export const LATE_ROUND_ONLY_POSITIONS: readonly Position[] = ["K", "DEF"];
export function deferredLateRoundPosition(
  position: Position,
  roster: readonly RosterSlot[],
  slotConfig: readonly RosterSlotConfig[],
  roundsFromEnd: number | undefined,
): boolean;
```

- [ ] **Step 1: Write the failing tests**

In `src/draft-engine/scoring.test.ts`:

```typescript
describe("deferredLateRoundPosition", () => {
  const slots = STANDARD_ROSTER_SLOTS; // 14 slots: QB1 RB2 WR2 TE1 FLEX1 K1 DEF1 BENCH6

  function rosterOf(count: number): readonly RosterSlot[] {
    return Array.from({ length: count }, (_, index) => ({ slot: BENCH_SLOT, playerId: `p${index}` }));
  }

  it("is not deferred at all when the policy carries no rounds-from-the-end", () => {
    expect(deferredLateRoundPosition("K", rosterOf(0), slots, undefined)).toBe(false);
  });

  it("defers a kicker early, when other starting slots are still open", () => {
    expect(deferredLateRoundPosition("K", rosterOf(0), slots, 2)).toBe(true);
    expect(deferredLateRoundPosition("DEF", rosterOf(5), slots, 2)).toBe(true);
  });

  it("stops deferring once the team is inside the final rounds", () => {
    // 14 slots, 2 rounds from the end: a roster of 12 or more has 2 or fewer picks left.
    expect(deferredLateRoundPosition("K", rosterOf(12), slots, 2)).toBe(false);
    expect(deferredLateRoundPosition("DEF", rosterOf(13), slots, 2)).toBe(false);
  });

  it("stops deferring the moment every other starting slot is filled, however early", () => {
    const startersFilled: readonly RosterSlot[] = [
      { slot: "QB", playerId: "q" }, { slot: "RB", playerId: "r1" }, { slot: "RB", playerId: "r2" },
      { slot: "WR", playerId: "w1" }, { slot: "WR", playerId: "w2" }, { slot: "TE", playerId: "t" },
      { slot: "FLEX", playerId: "f" },
    ];
    expect(deferredLateRoundPosition("K", startersFilled, slots, 2)).toBe(false);
  });

  it("never defers a position that is not one of the two", () => {
    expect(deferredLateRoundPosition("RB", rosterOf(0), slots, 2)).toBe(false);
    expect(deferredLateRoundPosition("QB", rosterOf(0), slots, 2)).toBe(false);
  });

  it("never defers when the league starts no kicker and no defense", () => {
    const noKdef = STANDARD_ROSTER_SLOTS.filter((slot) => slot.slot !== "K" && slot.slot !== "DEF");
    expect(deferredLateRoundPosition("K", rosterOf(0), noKdef, 2)).toBe(false);
  });
});
```

In `src/draft-engine/full-draft.test.ts`:

```typescript
it("finishes every seat with a kicker and a team defense, and takes neither early", () => {
  const state = runFullAutopickDraft({ slotConfig: STANDARD_ROSTER_SLOTS, teamCount: 12 });
  const totalRounds = totalRosterSlots(STANDARD_ROSTER_SLOTS);
  const positionOf = new Map(state.pool.map((entry) => [entry.playerId, entry.position] as const));

  for (const teamId of state.draftOrder) {
    const roster = state.rosters[teamId] ?? [];
    const positions = roster.map((filled) => (filled.playerId === null ? null : positionOf.get(filled.playerId)));
    expect(positions).toContain("K");
    expect(positions).toContain("DEF");
  }

  // Neither position taken before the final two rounds, unless the taking team had every other
  // starting slot already filled at that moment.
  for (const pick of state.picks) {
    const position = positionOf.get(pick.playerId);
    if (position !== "K" && position !== "DEF") continue;
    const round = Math.ceil(pick.pickNumber / state.draftOrder.length);
    if (round > totalRounds - AUTOPICK_CONFIG.lateRoundOnlyRoundsFromEnd!) continue;
    const rosterAtPick = rosterBefore(state, pick);
    expect(everyOtherStartingSlotFilled(rosterAtPick, STANDARD_ROSTER_SLOTS)).toBe(true);
  }
});
```

`runFullAutopickDraft`, `rosterBefore` and `everyOtherStartingSlotFilled` are local helpers in that
test file; the first already exists in some form (a loop that submits TIMER_EXPIRE until
`isComplete`), and the other two are three-line folds over `state.picks` and
`openStartingSlots`.

In `src/draft-engine/replay.test.ts`:

```typescript
it("replays a log with no late-round policy exactly as it did before the policy existed", () => {
  const policyless: DraftAutopickPolicy = {
    temperature: 3.0, needPerOpenStartingSlot: 0.4, startersFilledDamp: 0.6,
    rampFullAtRosterFraction: 0.5, surplusDamp: 0.25,
  };
  const withPolicy: DraftAutopickPolicy = { ...policyless, lateRoundOnlyRoundsFromEnd: 2 };

  const before = replayWithAutopickPolicy(FIXTURE_ACTIONS, policyless);
  const after = replayWithAutopickPolicy(FIXTURE_ACTIONS, withPolicy);

  expect(before.picks.map((pick) => pick.playerId)).toEqual(EXPECTED_PRE_POLICY_PICKS);
  // The policy changes the draft, which is the point; the assertion that matters is that the
  // ABSENT field reproduces the old behavior byte for byte, which the first expectation is.
  expect(after.picks.map((pick) => pick.playerId)).not.toEqual(before.picks.map((pick) => pick.playerId));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/draft-engine`
Expected: FAIL, `deferredLateRoundPosition` is not exported and `lateRoundOnlyRoundsFromEnd` is not a
known property.

- [ ] **Step 3: Add the policy constant**

In `src/draft-engine/config.ts`, add to `DraftAutopickPolicy`:

```typescript
  /**
   * HOW MANY ROUNDS FROM THE END a kicker or a team defense becomes takeable
   * (`LATE_ROUND_ONLY_POSITIONS`, `scoring.ts`), unless every other starting slot on the team is
   * already filled.
   *
   * THE PROBLEM IT SOLVES. `needMultiplier` is position-blind about WHEN: an open starting slot is
   * an open starting slot, so a kicker's `1 + needPerOpenStartingSlot` reads exactly like a second
   * receiver's, and the argmax will happily spend a fifth-round pick on the position every real
   * manager takes last. Nobody drafts a kicker in round five, and a room that autopicked one for an
   * absent manager would be visibly wrong to every other seat.
   *
   * AND IT NEVER STRANDS A SEAT WITHOUT ONE. Deferring is a preference and not a ban: the deferral
   * lifts the moment the team is inside the final `lateRoundOnlyRoundsFromEnd` rounds, and it lifts
   * immediately at any point in the draft once every other dedicated starting slot is filled. A
   * league whose roster starts no kicker and no defense is unaffected, because the deferral reads
   * the slot config and there is nothing to defer for.
   *
   * OPTIONAL, AND ABSENT MEANS NO DEFERRAL AT ALL — the pre-policy behavior, byte for byte, for the
   * identical F3 reason `surplusDamp` and `startersFilledDamp` carry: this value rides the
   * `START_DRAFT` snapshot (`StartDraftAction.autopick`), and a log written before this policy
   * existed must keep replaying without it forever.
   */
  readonly lateRoundOnlyRoundsFromEnd?: number;
```

and to `AUTOPICK_CONFIG`, with its own docblock paragraph:

```typescript
/**
 * `lateRoundOnlyRoundsFromEnd: 2` — the last two rounds of a standard roster, which under
 * `STANDARD_ROSTER_SLOTS` (14 slots) means a kicker and a defense become takeable at rounds 13 and
 * 14. Two and not one because both positions have to fit, and a one-round window would force a seat
 * to take one of them out of order on its very last pick.
 */
export const AUTOPICK_CONFIG: DraftAutopickPolicy = {
  temperature: 3.0,
  needPerOpenStartingSlot: 0.4,
  startersFilledDamp: 0.6,
  rampFullAtRosterFraction: 0.5,
  surplusDamp: 0.25,
  lateRoundOnlyRoundsFromEnd: 2,
};
```

- [ ] **Step 4: Add the predicate to `src/draft-engine/scoring.ts`**

```typescript
/**
 * The two positions a real draft board takes last. Named here rather than inlined at the one call
 * site so a superflex or a two-kicker format has one list to widen.
 */
export const LATE_ROUND_ONLY_POSITIONS: readonly Position[] = ["K", "DEF"];

/**
 * Whether a candidate at `position` should be passed over for now — see
 * `DraftAutopickPolicy.lateRoundOnlyRoundsFromEnd` (`config.ts`) for the whole argument.
 *
 * Three ways to be un-deferred, and a candidate needs only one: the policy carries no
 * rounds-from-the-end at all (a pre-policy snapshot), the team is inside the final rounds, or every
 * OTHER dedicated starting slot on the team is already filled. "Rounds left" is derived from the
 * team's OWN roster length against the total slot count, never from the global pick number, so a
 * team redeeming owed picks is measured against its own progress exactly the way `needRamp` is.
 */
export function deferredLateRoundPosition(
  position: Position,
  roster: readonly RosterSlot[],
  slotConfig: readonly RosterSlotConfig[],
  roundsFromEnd: number | undefined,
): boolean {
  if (roundsFromEnd === undefined) return false;
  if (!LATE_ROUND_ONLY_POSITIONS.includes(position)) return false;
  const roundsLeft = totalRosterSlots(slotConfig) - roster.length;
  if (roundsLeft <= roundsFromEnd) return false;
  return slotConfig.some(
    (slot) =>
      slot.slot !== BENCH_SLOT &&
      !LATE_ROUND_ONLY_POSITIONS.includes(slot.slot as Position) &&
      openStartingSlots(slot.slot as Position, roster, slotConfig) > 0,
  );
}
```

`totalRosterSlots`, `openStartingSlots` and `BENCH_SLOT` are already available to this module.

- [ ] **Step 5: Honor it in `bestAvailableFor` (`src/draft-engine/selectors.ts`)**

Inside the argmax loop, and with a fallback that can never strand a pick:

```typescript
  let best: DraftPoolEntry | null = null;
  let bestScore = -Infinity;
  /** The best candidate ignoring the late-round deferral, kept so a board that is ENTIRELY kickers
   *  and defenses (the endgame, or a pool nearly exhausted) still returns a pick rather than null.
   *  Deferring is a preference; refusing to pick is never one. */
  let bestDeferred: DraftPoolEntry | null = null;
  let bestDeferredScore = -Infinity;
  let legalIndex = 0;
  for (const entry of available) {
    if (!canFill(entry)) continue;
    const needOptions = rosteredCounts === null
      ? baseNeedOptions
      : { ...baseNeedOptions, rosteredAtPosition: rosteredCounts.get(entry.position) ?? 0 };
    const score =
      rankWeight(legalIndex, policy.temperature) *
      needMultiplier(entry.position, roster, state.config.slotConfig, needOptions);
    legalIndex += 1;
    if (deferredLateRoundPosition(entry.position, roster, state.config.slotConfig, policy.lateRoundOnlyRoundsFromEnd)) {
      if (score > bestDeferredScore) {
        bestDeferred = entry;
        bestDeferredScore = score;
      }
      continue;
    }
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best ?? bestDeferred;
```

`legalIndex` increments for every legal candidate whether deferred or not, so the board rank a
candidate is scored at is unchanged by the deferral: a deferred kicker sitting at legal index 40 is
still index 40 when the deferral lifts, and the ordering of everyone below him is untouched.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/draft-engine`
Expected: PASS, whole directory. `src/draft-engine` is held to 100% branch coverage, so run
`npx vitest run src/draft-engine --coverage` and confirm no uncovered branch was introduced.

- [ ] **Step 7: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint src/draft-engine`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/draft-engine
git commit -m "$(cat <<'EOF'
feat(draft-engine): autopick takes a kicker and a defense late, never early

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 2: The pipeline gate learns the two positions

**Files:**
- Modify: `src/projections/nflverse/players.ts`
- Modify: `src/projections/nflverse/players.test.ts`

**Interfaces:**
- Produces: `projectedPosition("K") === "K"`. `DEF` is deliberately NOT added: no source row carries
  it, so no file row can ever narrow to it, and the defense candidates are built from the 32
  synthetic universe rows instead.

- [ ] **Step 1: Write the failing test**

```typescript
it("recognizes a kicker, who is now projected", () => {
  expect(projectedPosition("K")).toBe("K");
  expect(projectedPosition("PK")).toBeNull();
});

it("still narrows a team defense to nothing, because no source row is one", () => {
  expect(projectedPosition("DEF")).toBeNull();
  expect(projectedPosition("DST")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/projections/nflverse/players.test.ts`
Expected: FAIL, `projectedPosition("K")` returns null.

- [ ] **Step 3: Widen the gate**

```typescript
    case "TE":
      return "TE";
    /**
     * THE KICKER (the 2026-09-05 K and DEF round). One case and not two: nflverse spells him `K` in
     * every row of every file checked, 2013 through 2025, and the product's stats provider's `PK` is
     * a different feed's spelling that never reaches this function. Adding him here is what makes
     * `isProjectedCandidate` admit his rows, which is the one gate that has kept every kicker out of
     * this engine since it was built.
     *
     * THERE IS NO `DEF` CASE AND THERE CANNOT BE ONE. A team defense is not a person, so no row in
     * any nflverse file is one, so no file position could ever narrow to it. The 32 defenses are
     * built from the synthetic universe rows `crosswalk.ts`'s `seedTeamDefenseUniverse` writes, by
     * their own candidate builder (`preseason/kdef-candidates.ts`), which is exactly why the spec
     * calls for a separate builder rather than a wider gate.
     */
    case "K":
      return "K";
```

- [ ] **Step 4: Run the test to verify it passes and check what else moved**

Run: `npx vitest run src/projections`
Expected: PASS. This change admits kicker rows to `allPositions` and therefore to several loaders.
Any test that asserts a count over "every projected player" will move; read each failure and confirm
the new number is the kicker count, then update the expectation with a comment naming this round.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint src/projections`, `npx vitest run src/projections`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/projections
git commit -m "$(cat <<'EOF'
feat(projections): the projection gate recognizes a kicker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 3: The candidate assembly

**Files:**
- Create: `src/projections/preseason/kdef-candidates.ts`
- Test: `src/projections/preseason/kdef-candidates.test.ts`

**Interfaces:**
- Consumes: `kickerSeasonsFrom`, `kickerCandidate`, `FITTED_KICKER_PRIORS`; `defenseGamesFrom`, `defenseCandidate`, `FITTED_DEFENSE_PRIORS`; `kickingWeekRowsForSeasons`, `teamDefenseWeekRowsForSeasons`; `HISTORY_SEASONS`, `PreseasonInputs`; `productTeamCode`, `sourceTeamCode`, `teamDefenseUniverseIds`; `teamObservationsAsOf` for the game scores that supply points allowed.
- Produces:

```typescript
export interface KdefHistory {
  readonly kickerSeasons: readonly KickerSeason[];
  readonly defenseGames: readonly DefenseGame[];
  /** Defense rows whose game score the store could not supply. Reported, never zeroed. */
  readonly defenseGamesWithoutScore: number;
}
export async function loadKdefHistory(db: ReadonlyDb, season: number, asOf: Date): Promise<KdefHistory>;
export function kdefCandidates(inputs: PreseasonInputs, history: KdefHistory, rules: ScoringRules): readonly BoardCandidate[];
```

- [ ] **Step 1: Write the failing test**

```typescript
describe("kdefCandidates", () => {
  it("builds one candidate per kicker on the week-one roster and one per club", () => {
    const candidates = kdefCandidates(inputsWithKickers(["k1", "k2"]), EMPTY_HISTORY, PPR_SCORING);
    expect(candidates.filter((c) => c.position === "K").map((c) => c.playerId)).toEqual(["k1", "k2"]);
    expect(candidates.filter((c) => c.position === "DEF")).toHaveLength(32);
  });

  it("gives every defense the source's own spelling on the synthetic universe id", () => {
    const defenses = kdefCandidates(inputsWithKickers([]), EMPTY_HISTORY, PPR_SCORING)
      .filter((c) => c.position === "DEF")
      .map((c) => c.playerId);
    expect(defenses).toContain("team-def:LA");
    expect(defenses).toContain("team-def:WAS");
    expect(defenses).not.toContain("team-def:LAR");
  });

  it("skips a roster kicker who is off the roster", () => {
    const candidates = kdefCandidates(inputsWithOffRosterKicker("k1"), EMPTY_HISTORY, PPR_SCORING);
    expect(candidates.some((c) => c.playerId === "k1")).toBe(false);
  });

  it("hands a kicker his OWN history and his CLUB's, separately", () => {
    const history = {
      kickerSeasons: [
        { season: 2024, playerId: "k1", team: "SF", games: 17, teamGames: 17, fieldGoalsAttempted: 40, fieldGoalsMade: 38, extraPointsAttempted: 30, extraPointsMade: 30 },
        { season: 2024, playerId: "other", team: "DEN", games: 17, teamGames: 17, fieldGoalsAttempted: 10, fieldGoalsMade: 5, extraPointsAttempted: 60, extraPointsMade: 55 },
      ],
      defenseGames: [],
      defenseGamesWithoutScore: 0,
    };
    // k1 is on DEN this season: his make rate is his own (very good), his attempt volume is DEN's.
    const candidate = kdefCandidates(inputsWithKickerOn("k1", "DEN"), history, PPR_SCORING)
      .find((c) => c.playerId === "k1");
    const attempts = candidate!.perGame.fieldGoalsMade + (candidate!.perGame.fieldGoalsMissed ?? 0);
    const rate = candidate!.perGame.fieldGoalsMade / attempts;
    expect(rate).toBeGreaterThan(FITTED_KICKER_PRIORS.leagueFieldGoalMakeRate);
    expect(attempts).toBeLessThan(FITTED_KICKER_PRIORS.leagueFieldGoalAttemptsPerGame);
  });

  it("reads only the seasons before the one it projects", async () => {
    const history = await loadKdefHistory(db, 2025, MOMENT);
    expect(history.kickerSeasons.every((s) => s.season < 2025)).toBe(true);
    expect(history.defenseGames.every((g) => g.season < 2025)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/projections/preseason/kdef-candidates.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the module**

`loadKdefHistory` reads the `HISTORY_SEASONS` seasons before `season` from
`kickingWeekRowsForSeasons` and `teamDefenseWeekRowsForSeasons`, folds them with
`kickerSeasonsFrom`/`defenseGamesFrom`, and builds the points-allowed map from the schedule's own
team observations at `asOf`. Its docblock states in bold that it reads STRICTLY prior seasons and
never the season being projected, which is the same discipline `loadPreseason`'s own history loop
keeps, and that the `asOf` gate applies to the SCORE side (a live board must not see this season's
games) while the archived history tables carry only completed seasons by construction.

`kdefCandidates` walks `inputs.roster`, skips `status === "off_roster"`, and for each row whose
`inputs.positions` says `K` builds a kicker candidate from his own history and his 2026 club's
history. It then builds one defense candidate per entry in `teamDefenseUniverseIds()`, from that
club's own defense games. It returns them sorted by `playerId` so the assembly is deterministic, the
same contract `preseasonCandidates` keeps.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/projections/preseason/kdef-candidates.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint src/projections/preseason`,
`npx vitest run src/projections`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/projections/preseason/kdef-candidates.ts src/projections/preseason/kdef-candidates.test.ts
git commit -m "$(cat <<'EOF'
feat(projections): assemble the kicker and team defense candidates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 4: The decision, the fallback, and the board

**Files:**
- Create: `src/projections/preseason/kdef-decision.ts`
- Test: `src/projections/preseason/kdef-decision.test.ts`
- Modify: `src/projections/preseason/board.ts` (the `market_order_only` reason)
- Modify: `src/projections/market/blend.ts` (`shippedPreseasonCandidates` appends)

**Interfaces:**
- Produces:

```typescript
export type KdefVerdict = "projected" | "market_order";
export const KDEF_DECISION: Readonly<Record<"K" | "DEF", KdefVerdict>>;
export function marketOrderCandidates(
  ordered: readonly { readonly playerId: string; readonly position: "K" | "DEF"; readonly team: string }[],
  season: number,
): readonly BoardCandidate[];
```

`KDEF_DECISION` is written by hand, once, from the results document Phase B Task 7 commits, and its
docblock quotes that document's own gate numbers per position and links to it by path. It is a
committed constant and not a database read, so a board is never quietly re-decided by a query.

- [ ] **Step 1: Write the failing test**

```typescript
describe("the market-order fallback", () => {
  it("gives a fallen-back position no projected points and no basis for a tier", () => {
    const candidates = marketOrderCandidates(
      [
        { playerId: "k1", position: "K", team: "SF" },
        { playerId: "k2", position: "K", team: "DEN" },
      ],
      2026,
    );
    for (const candidate of candidates) {
      expect(computeFantasyPoints(candidate.perGame, candidate.position, PPR_SCORING)).toBe(0);
      expect(candidate.perGameTierPoints).toBeUndefined();
      expect(candidate.reasons).toEqual([{ code: "market_order_only", marketRank: expect.any(Number) }]);
    }
  });

  it("keeps the market's own order in the market rank", () => {
    const candidates = marketOrderCandidates(
      [
        { playerId: "k1", position: "K", team: "SF" },
        { playerId: "k2", position: "K", team: "DEN" },
      ],
      2026,
    );
    expect(candidates.map((c) => c.reasons[0])).toEqual([
      { code: "market_order_only", marketRank: 1 },
      { code: "market_order_only", marketRank: 2 },
    ]);
  });

  it("names a verdict for both positions", () => {
    expect(["projected", "market_order"]).toContain(KDEF_DECISION.K);
    expect(["projected", "market_order"]).toContain(KDEF_DECISION.DEF);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/projections/preseason/kdef-decision.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Add the reason and write the module**

In `board.ts`:

```typescript
  /**
   * THE HONEST FALLBACK (spec §5 Phase B's decision rule). This position did NOT pass its
   * preregistered gates, so the engine has no projection it is entitled to state for it and the row
   * carries the market's own order and nothing else: no projected points, no range, no tier. The
   * reason exists so the surface can SAY that rather than render a blank row a reader would take for
   * a bug. `marketRank` is the position's own 1-based order in the market's board.
   *
   * See `docs/research/2026-09-05-kicker-defense-preregistration-results.md` for which position, if
   * either, took this path and on which gate it failed.
   */
  | { readonly code: "market_order_only"; readonly marketRank: number }
```

`marketOrderCandidates` produces one candidate per entry with a `perGame` line of `STAT_FIELDS` all
zero, no optional field at all, no `perGameTierPoints`, a degenerate games outlook at the season's own
game count, and the single reason. Its docblock states that a zero line here means "no projection",
never "we project zero", and that the surface must read the reason and not the number.

In `blend.ts`'s `shippedPreseasonCandidates`, after the existing return value is computed:

```typescript
  // THE TWO POSITIONS THE BLEND DOES NOT TOUCH. `blendBoard` anchors a candidate to the market's own
  // ADP board, and neither of these positions has a fitted blend constant or a props anchor, so
  // running them through it would be applying a correction measured on skill positions to a
  // population it was never measured on. They are appended AFTER the blend, exactly as built.
  const kdef = KDEF_DECISION.K === "projected" || KDEF_DECISION.DEF === "projected"
    ? kdefCandidates(inputs, await loadKdefHistory(db, inputs.season, inputs.moment), PPR_SCORING)
    : [];
  const fallback = await marketOrderFallbackFor(db, inputs, KDEF_DECISION);
  return [...blended, ...kdef.filter((candidate) => KDEF_DECISION[candidate.position as "K" | "DEF"] === "projected"), ...fallback];
```

`marketOrderFallbackFor` reads the ADP board for whichever of the two positions fell back and returns
`marketOrderCandidates` over it. Both helpers live in `kdef-decision.ts` so `blend.ts` gains four
lines and no new judgment.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/projections`
Expected: PASS.

- [ ] **Step 5: Run gate G4**

```bash
npm run projections:kdef:judgment -- --season 2025 --isolation-emit /tmp/kdef-g4-after.txt
diff /tmp/kdef-g4-before.txt /tmp/kdef-g4-after.txt && echo "G4 PASS"
```

Expected: no output from `diff`, then `G4 PASS`. If it differs, the difference is a defect in this
plan's changes and must be fixed before continuing, never accepted.

- [ ] **Step 6: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint src/projections`, `npx vitest run src/projections`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add src/projections/preseason/kdef-decision.ts src/projections/preseason/kdef-decision.test.ts src/projections/preseason/board.ts src/projections/market/blend.ts
git commit -m "$(cat <<'EOF'
feat(projections): kickers and defenses reach the board, market order when a gate failed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 5: The harness reports both positions

**Files:**
- Modify: `scripts/preseason-report.ts`

- [ ] **Step 1: Widen the scored positions and the league shape**

`SCORED` becomes `["QB", "RB", "WR", "TE", "K", "DEF"]` and `SLOTS` becomes
`STANDARD_ROSTER_SLOTS` unfiltered, with the existing docblock rewritten to say why the filter is
gone: Phase B projects both positions now, so their slots are no longer guaranteed blanks. The
`decision-report.ts` shape it deliberately matches gets the same change in the same commit, or the
comment claiming they match becomes false.

- [ ] **Step 2: Report the three baselines per position**

Under the existing `AGAINST THE OUTCOME` block, add one block per new position printing, for K and
DEF: the model's Spearman, the last-season-order baseline's, the ADP baseline's on the covered
subset, the flat-board baseline's, and the p25-to-p75 coverage. The numbers come from
`kdef-scorecard.ts`'s own gate functions, so the harness and the judgment cannot disagree about what a
gate measures.

- [ ] **Step 3: Run it on the two default seasons**

Run: `npm run projections:preseason`
Expected: completes, prints the two new blocks. Record the numbers in the ledger.

- [ ] **Step 4: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint scripts`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/preseason-report.ts scripts/decision-report.ts
git commit -m "$(cat <<'EOF'
feat(projections): the preseason harness reports kicker and team defense

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 6: The peek renders what is known and nothing else

**Files:**
- Modify: `src/league-room/outlook/groups.ts`
- Modify: `src/league-room/outlook/groups.test.ts`
- Modify: `src/league-room/lib/player-season-view.ts`
- Modify: `src/league-room/lib/player-season-view.test.ts`

**Interfaces:**
- Produces: the five new `BoardReason` codes render as outlook lines; a kicker's and a defense's
  season strip shows the components each position actually has.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("the kicker and team defense outlook lines", () => {
  it("says what a kicker's projection was built from", () => {
    const lines = outlookGroupsFor([
      { code: "kicker_opportunity", fieldGoalAttemptsPerGame: 2.1, extraPointAttemptsPerGame: 2.6, fieldGoalMakeRate: 0.87 },
    ], "K");
    expect(lines.join(" ")).toContain("2.1");
    expect(lines.join(" ")).toContain("87");
    expect(lines.join(" ")).not.toMatch(/[;—]/);
  });

  it("says a kicker with no kicking history has none", () => {
    const lines = outlookGroupsFor([{ code: "kicker_no_history" }], "K");
    expect(lines.join(" ").toLowerCase()).toContain("no kicking record");
  });

  it("says what a team defense's projection was built from", () => {
    const lines = outlookGroupsFor([
      { code: "defense_takeaways", sacksPerGame: 2.6, takeawaysPerGame: 1.4, tierPointsPerGame: 1.9 },
    ], "DEF");
    expect(lines.join(" ")).toContain("2.6");
    expect(lines.join(" ")).not.toMatch(/[;—]/);
  });

  it("says plainly when a position is in market order and shows no projection", () => {
    const lines = outlookGroupsFor([{ code: "market_order_only", marketRank: 4 }], "K");
    expect(lines.join(" ").toLowerCase()).toContain("draft order");
    expect(lines.join(" ").toLowerCase()).not.toContain("projected");
  });
});
```

The copy is written and reviewed against the persona panel in this step. Working phrasings, all free
of em-dashes, semicolons, competitor names and tips:

- `kicker_opportunity`: "His club attempted 2.1 field goals and 2.6 extra points a game. He has made 87 percent of his own field goal attempts."
- `kicker_no_history`: "No kicking record yet. This projection uses his club's kicking volume and the league's own make rates."
- `defense_takeaways`: "2.6 sacks and 1.4 takeaways a game, and 1.9 points a game from what this defense allows."
- `defense_no_history`: "No defensive record in the seasons this board reads. This projection uses the league's own rates."
- `market_order_only`: "Kickers are listed in draft order this season. The model did not clear its own accuracy bar for the position, so there is no projection here."

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/league-room`
Expected: FAIL, the reason codes fall through to nothing.

- [ ] **Step 3: Implement the lines and the season strip**

`groups.ts` gains one branch per code. `player-season-view.ts` gains a K variant (field goals made
and attempted, extra points made and attempted, per season, from `kickingWeekRowsFor`) and a DEF
variant (sacks, interceptions, fumble recoveries, defensive touchdowns, points allowed per game, from
`teamDefenseWeekRowsForSeasons`), each rendering absence as absence where a season carries no row.
The Read card and the story module already render their own absence for a player with no capsule and
gain no branch.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/league-room`
Expected: PASS.

- [ ] **Step 5: Gates**

Run: `npx tsc --noEmit -p .`, `npx eslint src/league-room`, `npx vitest run src/league-room`,
`npx vitest run src/design`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/league-room
git commit -m "$(cat <<'EOF'
feat(league-room): the peek reads a kicker and a team defense honestly

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

### Task 7: The board's own tabs, end to end

**Files:**
- Create: `e2e/board-kdef.spec.ts`

- [ ] **Step 1: Write the spec**

Against a seeded league, open the Draft HQ board, select the K tab, and assert that at least one row
is present and that it carries either a projected value and a tier band or the market-order label,
never both and never neither. Repeat for the DEF tab. The spec reads the label text from the same
copy constants Task 6 introduced rather than restating a string.

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/board-kdef.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/board-kdef.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): the board's kicker and team defense tabs render rows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015uZo5nZHCUhYSWSzEjWgFS
EOF
)"
```

---

## Self-review

**Spec coverage.** §5 Phase C names five things and each has a task: the pipeline gate (Task 2), the
board (Tasks 3, 4), autopick (Task 1), peek and page (Task 6), and copy (Task 6's step 1, where the
strings are written and checked). §5 Phase B's decision rule is implemented in Task 4 in both
branches, which is what the spec demands: the labeled fallback path is built whether or not it is
taken. §8's autopick tests are Task 1, the design guards and copy scan are Task 6, and the E2E-lite
board check is Task 7. §2's non-goals are honored: no scoring preset changes, no capsule for either
position, no discovery law for either.

**No placeholders.** Task 1 carries literal code for every change. Tasks 3, 4, 5, 6 and 7 carry
literal test code and describe their implementations against exact signatures; Task 6 carries the
literal copy strings.

**Type consistency.** `deferredLateRoundPosition`'s four parameters are spelled identically in the
test, the implementation and the `selectors.ts` call site. The five `BoardReason` codes introduced
across Phase B Tasks 2 and 3 and Phase C Task 4 are the same five the outlook branches on in Task 6.
`KDEF_DECISION` is keyed on the string literals `"K"` and `"DEF"`, which is how `blend.ts` indexes it.
