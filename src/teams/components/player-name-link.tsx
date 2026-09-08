"use client";

import Link from "next/link";
import { useCallback, type MouseEvent, type ReactNode } from "react";
import { useLinkLeague, playerPageHref } from "@/components/app-shell/shell-leagues";
import { openPlayerPeek } from "@/league-room/components/player-peek";

/** What one player's name resolves to on this page: the anchor's href, and the click that opens
 *  the peek in place. `null` for a reader with no league, where no player page exists for him. */
export interface PlayerLink {
  readonly href: string;
  readonly onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** A plain left click, with nothing held: the one click the peek takes over. Anything else (a
 *  modifier for a new tab, a middle click, a keyboard activation the browser reports as a click
 *  with `detail` 0) is left to the anchor, which is what makes the anchor real. */
function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.detail > 0;
}

/**
 * ONE RESOLUTION FOR EVERY PLAYER NAME ON THE TEAM PAGE (player-links fix round, 2026-09-08,
 * founder: "why aren't the player names linked on the team page so you can look at the player
 * peek?"). The href is the roster's own (`useLinkLeague`: the league the reader stands in, else
 * the rail's first league), so the roster, the depth chart and the three leader tables all
 * resolve a name the same way. A plain click opens `PlayerPeekHost`'s sheet in place, which
 * carries its own "Full page" link; every other way of following the link is the anchor's.
 */
export function usePlayerLink(): (playerId: string, name: string) => PlayerLink | null {
  const leagueId = useLinkLeague();
  return useCallback(
    (playerId: string, name: string) => {
      if (leagueId === null) return null;
      return {
        href: playerPageHref(leagueId, playerId),
        onClick: (event) => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          openPlayerPeek({ leagueId, playerId, name });
        },
      };
    },
    [leagueId],
  );
}

export interface PlayerNameLinkProps {
  /** The product's player id, or `null` for a name the universe cannot resolve. */
  readonly playerId: string | null;
  readonly name: string;
  readonly className?: string;
  /** What the anchor wraps; the name itself by default. */
  readonly children?: ReactNode;
}

/**
 * A player's name as a real anchor to his analysis page, opening the peek on a plain click; plain
 * text when there is no player behind the name or no league to read him in. Never a dead link.
 */
export function PlayerNameLink({ playerId, name, className = "", children }: PlayerNameLinkProps) {
  const linkFor = usePlayerLink();
  const link = playerId === null ? null : linkFor(playerId, name);
  if (link === null) return <span className={className}>{children ?? name}</span>;
  return (
    <Link href={link.href} onClick={link.onClick} className={`rounded-sm text-text-primary underline decoration-line underline-offset-2 hover:decoration-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}>
      {children ?? name}
    </Link>
  );
}
