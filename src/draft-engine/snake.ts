import type { MakePickAction } from "@/domain/draft";
import { totalPickCount, type DraftReduceResult, type DraftState } from "./state";
import { snakeTeamForPick } from "./order";
import { applyPick, expectApplied, redeemOwedPick } from "./apply-pick";
import { bestAvailableFor, catchUpTeamId, currentTier, hasOwedPicks, queueFor, teamOnClock } from "./selectors";

/**
 * Settles the CATCH-UP turn a redemption or a catch-up autopick just resolved (Task 5): if a
 * pick is still owed anywhere, the next team in line gets a fresh clock (`turnStartedAt`
 * reset, `pickNumber` left exactly where it is — its only job past `totalPickCount` is to mark
 * "the normal snake schedule is done", not to count catch-up turns). Otherwise every roster is
 * finally complete, and the draft ends here instead of at the last normal pick.
 */
function settleCatchUp(state: DraftState, timestamp: string): DraftState {
  return hasOwedPicks(state) ? { ...state, turnStartedAt: timestamp } : { ...state, phase: "complete", turnStartedAt: null };
}

/**
 * Moves to the next pick, or — once every roster spot has run through the normal snake order —
 * ends the draft, UNLESS a pick is still owed (Task 5): a roster that skipped a turn is short a
 * player, and every downstream consumer (`commitDraftResults`, `defaultLineup`, `validateLineup`)
 * assumes every team filled the same number of slots. So instead of completing, the state stays
 * `in_progress` with a fresh clock — the CATCH-UP turn `teamOnClock`'s own catch-up arm (and
 * `reduceMakePick`/`reduceSnakeExpiry` below) resolve one owed pick at a time until none remain.
 */
export function advanceSnake(state: DraftState, timestamp: string): DraftState {
  const next = state.pickNumber + 1;
  if (next > totalPickCount(state)) {
    return hasOwedPicks(state) ? { ...state, pickNumber: next, turnStartedAt: timestamp } : { ...state, pickNumber: next, phase: "complete", turnStartedAt: null };
  }
  return { ...state, pickNumber: next, turnStartedAt: timestamp };
}

export function reduceMakePick(state: DraftState, action: MakePickAction): DraftReduceResult {
  if (state.config.format !== "snake") {
    return { ok: false, reason: "This is an auction draft. Nominate a player instead of picking." };
  }

  const onClock = teamOnClock(state);
  const inCatchUp = state.pickNumber > totalPickCount(state);

  // The ordinary case: it is genuinely this team's turn, on the normal snake schedule. Never
  // reached while `inCatchUp` — a catch-up turn is resolved by redemption below, always at the
  // OWED pick number, never at `state.pickNumber`'s own (unused, past-the-board) value.
  if (!inCatchUp && onClock === action.teamId) {
    const applied = applyPick(state, { teamId: action.teamId, playerId: action.playerId, price: null, auto: false, timestamp: action.timestamp });
    if (!applied.ok) return applied;
    return { ok: true, state: advanceSnake(applied.state, action.timestamp) };
  }

  const owed = state.owedPicks[action.teamId] ?? [];
  if (owed.length === 0) return { ok: false, reason: "It's not your turn to pick." };

  // A redeemed owed pick may be made ANY time (NFFC's forgiveness) — on somebody else's normal
  // turn, mid-draft, or as the team currently holding the catch-up clock. Only the LATTER also
  // settles the turn: redeeming out of band never steals whatever turn is actually running.
  const redeemed = redeemOwedPick(state, { teamId: action.teamId, playerId: action.playerId, auto: false, timestamp: action.timestamp });
  if (!redeemed.ok) return redeemed;
  if (inCatchUp && onClock === action.teamId) return { ok: true, state: settleCatchUp(redeemed.state, action.timestamp) };
  return redeemed;
}

/**
 * Autopick policy: the highest-ranked undrafted player the team on the clock can legally
 * roster. `state.pool` is the ranking — an explicit input snapshotted at START_DRAFT — so
 * the same action log always produces the same autopick.
 */
export function reduceSnakeExpiry(state: DraftState, timestamp: string): DraftReduceResult {
  if (state.pickNumber > totalPickCount(state)) return reduceCatchUpExpiry(state, timestamp);

  const teamId = snakeTeamForPick(state.draftOrder, state.pickNumber);
  if (skipEligible(state, teamId)) {
    return { ok: true, state: advanceSnake(addOwedPick(state, teamId, state.pickNumber), timestamp) };
  }

  const best = bestAvailableFor(state, teamId);
  if (best === null) return { ok: false, reason: "No eligible player is available to auto-pick." };
  const applied = applyPick(state, { teamId, playerId: best.playerId, price: null, auto: true, timestamp });
  const nextState = expectApplied(applied, "autopick chosen by bestAvailableFor must be applicable");
  return { ok: true, state: advanceSnake(nextState, timestamp) };
}

/**
 * The CONSENT ruling (Plan's Task 5): a team with NO queue, at a tier slow enough for the room
 * to still be asleep, and under the per-team owed allowance, gets skipped rather than
 * autopicked — everybody else with a queue already told us what to take, and a live room (the
 * fast tiers) can't wait on anybody. Reads `state.config.skipPolicy`, which `reduceStart`
 * snapshotted from the action log, never `DRAFT_SKIP_POLICY` itself — the reducer-purity rule
 * this whole file's docblock (`reduce.ts`) states applies here exactly as everywhere else.
 */
function skipEligible(state: DraftState, teamId: string): boolean {
  const policy = state.config.skipPolicy ?? null;
  if (policy === null) return false;
  if (queueFor(state, teamId).length > 0) return false;
  // `reduceSnakeExpiry` only ever runs against a state whose phase is "in_progress" with a
  // turn already running — every reducer that keeps this phase always sets `turnStartedAt`
  // (`reduceStart`, `advanceSnake`, `settleCatchUp`) — so `currentTier` can never be null
  // here, the same invariant `auction.nominatingTeamId!` leans on in `auction.ts`.
  const tier = currentTier(state)!;
  if (tier.pickSeconds < policy.appliesAtOrAbovePickSeconds) return false;
  const owedSoFar = state.owedPicks[teamId]?.length ?? 0;
  return owedSoFar < policy.maxOwedPerTeam;
}

function addOwedPick(state: DraftState, teamId: string, pickNumber: number): DraftState {
  const existing = state.owedPicks[teamId] ?? [];
  return { ...state, owedPicks: { ...state.owedPicks, [teamId]: [...existing, pickNumber] } };
}

/**
 * The catch-up clock ran out. Unlike a normal turn, this NEVER skips further — every owed pick
 * that reaches here has already had its one forgiveness, and a catch-up turn that could itself
 * be skipped would let a draft stall forever waiting on nobody. So it always autopicks, exactly
 * `reduceSnakeExpiry`'s own autopick branch, at the pick number owed rather than the counter's.
 */
function reduceCatchUpExpiry(state: DraftState, timestamp: string): DraftReduceResult {
  const teamId = catchUpTeamId(state);
  if (teamId === null) return { ok: false, reason: "No pick is currently owed." };
  const best = bestAvailableFor(state, teamId);
  if (best === null) return { ok: false, reason: "No eligible player is available to auto-pick." };
  const redeemed = redeemOwedPick(state, { teamId, playerId: best.playerId, auto: true, timestamp });
  const nextState = expectApplied(redeemed, "autopick chosen by bestAvailableFor must be applicable");
  return { ok: true, state: settleCatchUp(nextState, timestamp) };
}
