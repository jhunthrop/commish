import { LowerThird, type LowerThirdCell } from "@/components/ui";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import type { ProofStats } from "@/matchmaking/contract";
import { OpenLeagueCta } from "./open-league-shared";

export interface FrontDoorLowerThirdProps {
  readonly stats: ProofStats;
  /** The fullest genuinely-filling league — the SAME object the hero's verb points at, derived
   *  once in `page.tsx`, so the strip and the hero can never name two different rooms. */
  readonly featuredLeague: PublicLeagueSummary | null;
  readonly signedIn: boolean;
}

/**
 * The front door's lower third (Sunday v5, law 6): the subject, the operator's own proof, and
 * the verb, in the strip a broadcast puts them in.
 *
 * `ProofStrip`'s three numbers moved here and kept their discipline: every cell renders only
 * when `proofStats` actually earned the number (law 7 — a null is an absent cell, never a zero).
 * The subject cell names the room closest to firing with its own seat count, which is this
 * page's version of the clock: a sit-and-go room's countdown IS its remaining seats.
 *
 * Renders nothing at all when there is neither a subject nor one earned number — a strip of
 * empty cells would be a decision the screen does not actually offer, and law 6's own diagnostic
 * ("no lower third means no decision") has to stay readable.
 */
export function FrontDoorLowerThird({ stats, featuredLeague, signedIn }: FrontDoorLowerThirdProps) {
  const cells: LowerThirdCell[] = [];

  if (featuredLeague !== null) {
    const seatsLeft = featuredLeague.teamCount - featuredLeague.filledTeams;
    cells.push({
      label: "Filling now",
      value: `${featuredLeague.name} · ${seatsLeft} ${seatsLeft === 1 ? "seat" : "seats"} left`,
    });
  }
  if (stats.roomsFillingNow !== null) {
    cells.push({ label: "Rooms filling", value: stats.roomsFillingNow });
  }
  if (stats.leaguesFilled !== null) {
    cells.push({ label: "Leagues filled this season", value: stats.leaguesFilled });
  }

  if (cells.length === 0) return null;

  return (
    <LowerThird
      cells={cells}
      live={featuredLeague !== null}
      action={
        featuredLeague === null ? null : (
          <OpenLeagueCta league={featuredLeague} signedIn={signedIn} emphasis="ink" />
        )
      }
    />
  );
}
