/**
 * THE TURN'S OWN FACT LEDGER — what a written sentence may cite (spec 3.7: "reasons never name
 * a number that is not on the turn's ledger"). Built from the same view the card renders, so the
 * writer can only ever be grounded in what the manager can see: every survival as a fraction
 * (the validator grounds its percent form too), every run count, value, rank, drop, pick label
 * and pick number, and every name on the card. The seats ahead are named "Seat N".
 */
import { pickLabel } from "@/domain/pick-label";
import type { AdvisorView, TurnLedger } from "./view";

type LedgerSource = Omit<AdvisorView, "ledger" | "voice" | "strategyTemplate">;

function pickNumbers(pickNumber: number, teamCount: number): readonly number[] {
  const label = pickLabel(pickNumber, teamCount);
  return [pickNumber, Number(label), Math.ceil(pickNumber / teamCount), ((pickNumber - 1) % teamCount) + 1];
}

function planNumbers(view: LedgerSource): readonly number[] {
  return view.plan.turns.flatMap((turn) => [
    turn.turn,
    ...pickNumbers(turn.pickNumber, view.teamCount),
    ...[...turn.targets, ...(turn.fallback === null ? [] : [turn.fallback])].flatMap((target) => [
      target.valueOverReplacement,
      target.positionRank,
      ...target.oddsByTurn.flatMap((cell) => (cell === null ? [] : [cell.survival, cell.runs, Math.round(cell.survival * cell.runs)])),
    ]),
  ]);
}

/**
 * THE COMPARISONS THE CARD INVITES, COMPUTED BY US (fix round 2): a writer told never to
 * subtract still wrote "beats Emerson by 16.1", and it grounded only because 16.1 happened to
 * be another row's drop. The pairwise gap in value over replacement between any two candidates
 * on the card, and each candidate's own drop to the next tier, are honest numbers a sentence
 * may compare with, so they go on the ledger explicitly rather than by coincidence.
 */
function comparisonNumbers(view: LedgerSource): readonly number[] {
  const values = view.now.map((candidate) => candidate.valueOverReplacement);
  const gaps = values.flatMap((a, i) => values.slice(i + 1).map((b) => Math.round(Math.abs(a - b) * 10) / 10));
  const drops = view.now.flatMap((candidate) => candidate.reasons.flatMap((reason) => (reason.code === "tier_cliff" ? [reason.dropToNextTier] : [])));
  return [...gaps, ...drops];
}

function nowNumbers(view: LedgerSource): readonly number[] {
  return view.now.flatMap((candidate) => [
    candidate.valueOverReplacement,
    candidate.positionRank,
    ...(candidate.makeItBack === null ? [] : [candidate.makeItBack.survival, candidate.makeItBack.runs, Math.round(candidate.makeItBack.survival * candidate.makeItBack.runs)]),
    ...candidate.reasons.flatMap(reasonNumbers),
  ]);
}

function reasonNumbers(reason: LedgerSource["now"][number]["reasons"][number]): readonly number[] {
  switch (reason.code) {
    case "tier_cliff":
      return [reason.playersLeftInTier, reason.dropToNextTier];
    case "roster_saturated":
      return [reason.alreadyRostered, reason.alreadyBenched];
    case "value_over_replacement":
      return [reason.valueOverReplacement, reason.positionRank];
    case "will_not_survive":
    case "safe_to_wait":
      return [reason.survivalProbability, reason.nextPick];
    case "no_further_turn":
      return [reason.pickNumber];
    case "fills_starting_slot":
      return [];
  }
}

function signalNumbers(view: LedgerSource): readonly number[] {
  const { run, collapses, ahead } = view.signals;
  return [
    ...(run === null ? [] : [run.count, run.window]),
    ...collapses.flatMap((row) => [row.playersLeftInTier, row.dropToNextTier]),
    ...ahead.flatMap((seat) => [
      seat.seat,
      seat.runs,
      ...pickNumbers(seat.pickNumber, view.teamCount),
      ...(seat.topPosition === null ? [] : [seat.topPosition.share, Math.round(seat.topPosition.share * seat.runs)]),
      ...(seat.topPlayer === null ? [] : [seat.topPlayer.share, Math.round(seat.topPlayer.share * seat.runs)]),
      seat.driver.picksObserved,
    ]),
    ahead.length,
  ];
}

export function buildTurnLedger(view: LedgerSource): TurnLedger {
  const numbers = new Set<number>([
    ...pickNumbers(view.pickNumber, view.teamCount),
    view.picksUntilYourTurn,
    view.teamCount,
    view.plan.runs,
    view.plan.horizon,
    ...planNumbers(view),
    ...nowNumbers(view),
    ...comparisonNumbers(view),
    ...signalNumbers(view),
  ]);
  // The tier letters the card prints ("tier A") in both the forms a writer capitalises them,
  // so "Tier A" is a phrase on the card rather than a two-word name nobody supplied (the live
  // firing of 2026-09-07 lost its strategy note to exactly that).
  const names = new Set<string>([
    ...Object.values(view.names),
    ...view.signals.ahead.map((seat) => `Seat ${seat.seat}`),
    ...view.signals.collapses.flatMap((row) => [`Tier ${row.tierLabel}`, `tier ${row.tierLabel}`]),
  ]);
  return { numbers: [...numbers], names: [...names] };
}
