"use client";

import Link from "next/link";
import { PlayerRow } from "@/components/ui";
import { usePlayerPageHref } from "@/components/app-shell/shell-leagues";
import type { TeamBoardPlayer } from "../contract";
import { Section } from "./section";

/** The mono facts after a roster row's name, each only when the board states it. Pure. */
export function rosterMetaLine(row: TeamBoardPlayer): string {
  const parts: string[] = [];
  if (row.boardRank !== null) parts.push(`Board ${row.boardRank}`);
  if (row.tier !== null) parts.push(`Tier ${row.tier}`);
  if (row.marketAdp !== null) parts.push(`ADP ${row.marketAdp.toFixed(1)}`);
  if (row.projectedPoints !== null) parts.push(`${row.projectedPoints.toFixed(1)} pts`);
  return parts.join(" · ");
}

/**
 * THE FANTASY PLAYERS ON THIS CLUB (coordinator's section 4): every board row in board order, in
 * the pool row treatment, each a link to his analysis page in the league the reader's links belong
 * to (`usePlayerPageHref`). A reader with no league gets the rows without links, which is the
 * honest rendering of a page that does not exist for him yet. The survival odds column is left to
 * the draft room, as ruled.
 */
export function RosterSection({ players, season }: { readonly players: readonly TeamBoardPlayer[]; readonly season: number }) {
  const hrefFor = usePlayerPageHref();
  return (
    <Section title="Fantasy players" basis={`The ${season} board, 12-team PPR, in board order`} held={players.length > 0}>
      <ul className="flex flex-col gap-1.5" aria-label="Fantasy players">
        {players.map((row) => {
          const href = hrefFor(row.player.id);
          const rendered = <PlayerRow player={row.player} positionRank={row.positionRank ?? undefined} meta={rosterMetaLine(row)} />;
          return (
            <li key={row.player.id}>
              {href === null ? (
                rendered
              ) : (
                <Link href={href} aria-label={row.player.name} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  {rendered}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
