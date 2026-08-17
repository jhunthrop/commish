/** 1-based round containing a 1-based pick number. */
export function roundForPick(teamCount: number, pickNumber: number): number {
  return Math.ceil(pickNumber / teamCount);
}

/**
 * Snake order: odd rounds run down the draft order, even rounds run back up it.
 * `draftOrder` is round-1 order; `pickNumber` is 1-based and global across rounds.
 */
export function snakeTeamForPick(draftOrder: readonly string[], pickNumber: number): string {
  if (!Number.isInteger(pickNumber) || pickNumber < 1) {
    throw new Error(`Invalid pick number: ${pickNumber}.`);
  }
  const teamCount = draftOrder.length;
  const round = roundForPick(teamCount, pickNumber);
  const indexInRound = (pickNumber - 1) % teamCount;
  const orderIndex = round % 2 === 1 ? indexInRound : teamCount - 1 - indexInRound;
  const team = draftOrder[orderIndex];
  if (team === undefined) throw new Error(`Invalid pick number: ${pickNumber}.`);
  return team;
}
