/**
 * "4.07" — the way a draft room names a pick: round, then the pick inside the round, two digits.
 * Pure, so the server's advisor (its ledger and its writer prompt), the quilt board and the
 * room's advisor tab print the identical label for the identical pick.
 */
export function pickLabelOf(round: number, pickInRound: number): string {
  return `${round}.${String(pickInRound).padStart(2, "0")}`;
}

/** The label for a global pick number in a room of `teamCount` seats. */
export function pickLabel(pickNumber: number, teamCount: number): string {
  if (!Number.isInteger(pickNumber) || pickNumber < 1 || !Number.isInteger(teamCount) || teamCount < 1) {
    throw new Error(`A pick label needs a positive pick number and team count; got ${pickNumber} of ${teamCount}.`);
  }
  return pickLabelOf(Math.ceil(pickNumber / teamCount), ((pickNumber - 1) % teamCount) + 1);
}
