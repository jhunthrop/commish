/**
 * "4.07" — the way a draft room names a pick: round, then the pick inside the round, two digits.
 * Pure, so the server's advisor (its ledger and its writer prompt) and the room's advisor tab
 * print the identical label for the identical pick.
 */
export function pickLabel(pickNumber: number, teamCount: number): string {
  if (!Number.isInteger(pickNumber) || pickNumber < 1 || !Number.isInteger(teamCount) || teamCount < 1) {
    throw new Error(`A pick label needs a positive pick number and team count; got ${pickNumber} of ${teamCount}.`);
  }
  const round = Math.ceil(pickNumber / teamCount);
  const inRound = ((pickNumber - 1) % teamCount) + 1;
  return `${round}.${String(inRound).padStart(2, "0")}`;
}
