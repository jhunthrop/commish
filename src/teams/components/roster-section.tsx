"use client";

import Link from "next/link";
import { PlayerRow } from "@/components/ui";
import { tierLetter } from "@/draft-hq/board/copy";
import { rosterStatusLabel } from "@research-ts/projections/preseason/roster-status-copy";
import type { TeamBoardPlayer } from "../contract";
import { usePlayerLink } from "./player-name-link";
import { Section } from "./section";

/** The mono facts after a roster row's name, each only when the board states it. The roster status
 *  leads when the board stored one (the roster-status gate, 2026-09-08), in the pill's own short
 *  word. The tier is the board's own letter (`tierLetter`: S for the summit, then A onward), never
 *  the zero-based index the store carries. Pure. */
export function rosterMetaLine(row: TeamBoardPlayer): string {
  const parts: string[] = [];
  if (row.rosterStatus !== null) parts.push(rosterStatusLabel(row.rosterStatus.status));
  if (row.boardRank !== null) parts.push(`Board ${row.boardRank}`);
  if (row.tier !== null) parts.push(`Tier ${tierLetter(row.tier)}`);
  if (row.marketAdp !== null) parts.push(`ADP ${row.marketAdp.toFixed(1)}`);
  if (row.projectedPoints !== null) parts.push(`${row.projectedPoints.toFixed(1)} pts`);
  return parts.join(" · ");
}

/**
 * THE FANTASY PLAYERS ON THIS CLUB (coordinator's section 4): every board row in board order, in
 * the pool row treatment, each a real anchor to his analysis page that opens the peek in place on
 * a plain click (`usePlayerLink`, the one resolution every name on this page shares). A reader
 * with no league gets the rows without links, which is the honest rendering of a page that does
 * not exist for him yet. The survival odds column is left to the draft room, as ruled.
 */
export function RosterSection({ players, season }: { readonly players: readonly TeamBoardPlayer[]; readonly season: number }) {
  const linkFor = usePlayerLink();
  return (
    <Section title="Fantasy players" basis={`The ${season} board, 12-team PPR, in board order`} held={players.length > 0}>
      <ul className="flex flex-col gap-1.5" aria-label="Fantasy players">
        {players.map((row) => {
          const link = linkFor(row.player.id, row.player.name);
          const rendered = <PlayerRow player={row.player} positionRank={row.positionRank ?? undefined} meta={rosterMetaLine(row)} />;
          return (
            <li key={row.player.id}>
              {link === null ? (
                rendered
              ) : (
                <Link href={link.href} onClick={link.onClick} aria-label={row.player.name} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
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
