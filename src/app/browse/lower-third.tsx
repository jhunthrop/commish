import { LowerThird, type LowerThirdCell } from "@/components/ui";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { OpenLeagueCta } from "@/league-room/components/open-league-shared";

export interface BrowseLowerThirdProps {
  /** P1 on the board above — the room with the fewest seats left among the rooms that have any
   *  claim at all, derived by the caller from the SAME `featuredFillingLeague` the shelf ranks
   *  with, so the strip and the board's leader row can never name two different rooms. */
  readonly leader: PublicLeagueSummary | null;
  /** How many rooms the current filter left on the board — the lobby's other honest figure. */
  readonly roomCount: number;
  readonly signedIn: boolean;
}

/**
 * THE LOBBY'S LOWER THIRD (Sunday v5, law 6): the subject, the clock, and one verb.
 *
 * The board above is a timing tower and a tower ends in a strip. The subject is P1 — the room the
 * ranking already put at the top — and a sit-and-go room's clock IS its remaining seats, the same
 * reading the front door's own strip takes (`front-door-lower-third.tsx`): the fewer seats left,
 * the sooner `fireWhenFullInTx` fires it. The verb is that room's own seat, repeated from its row
 * rather than invented here, which is exactly what law 6 frees a board to do.
 *
 * Renders nothing when nothing is filling. That is law 6's diagnostic used honestly rather than
 * dodged: with no claimed seat anywhere on the board there is no P1 to name, and a strip carrying
 * a count and no subject would be furniture pretending to be a decision. The rows still each
 * carry their own verb; the tower simply has no leader to put in the tower's own line.
 */
export function BrowseLowerThird({ leader, roomCount, signedIn }: BrowseLowerThirdProps) {
  if (leader === null) return null;

  const seatsLeft = leader.teamCount - leader.filledTeams;
  const cells: LowerThirdCell[] = [
    { label: "P1", value: leader.name },
    { label: "Seats left", value: seatsLeft, clock: true },
    { label: "Rooms open", value: roomCount },
  ];

  return <LowerThird cells={cells} live action={<OpenLeagueCta league={leader} signedIn={signedIn} emphasis="ink" />} />;
}
