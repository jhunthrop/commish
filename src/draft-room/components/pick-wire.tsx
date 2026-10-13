"use client";

import type { Player } from "@research-ts/domain/player";
import type { TeamCard } from "@/domain/league";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { PositionBadge } from "@/components/ui";
import type { PositionBadgeSize } from "@/components/ui/position-badge";
import { PlayerName } from "@/league-room/components/player-peek";
import { teamsById, teamName } from "../lib/lookups";
import { verdictForPick, verdictPopulation } from "../lib/verdict";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { VerdictChip } from "./verdict-chip";

export type PickWireVariant = "room" | "tv";

export interface PickWireProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
  /**
   * The pool's own ranked snapshot order, for the newest pick's verdict (Task 7). Required
   * rather than derived from `playersById`: a `Map`'s insertion order happens to carry the same
   * ranking today, and a board rank is far too load-bearing a fact to rest on that happening to
   * stay true.
   */
  readonly players: readonly Player[];
  /** @default "room" */
  readonly variant?: PickWireVariant;
}

const TEXT_SIZE: Readonly<Record<PickWireVariant, string>> = {
  room: "text-xs",
  tv: "text-base",
};

const BADGE_SIZE: Readonly<Record<PickWireVariant, PositionBadgeSize>> = {
  room: "sm",
  tv: "md",
};

interface WireEntry {
  readonly pick: CompletedPick;
  readonly player: Player;
}

/**
 * The last `DRAFT_ROOM_CONFIG.wire.maxItems` picks with a resolvable player, newest first. A
 * pick whose player id isn't in `playersById` (a resync gap, never expected in steady state) is
 * skipped rather than rendered with a placeholder — the band stays a list of true facts, never
 * a guess (rule 6: only true things move, and a fabricated name isn't a true one).
 */
function wireEntries(picks: readonly CompletedPick[], playersById: ReadonlyMap<string, Player>): readonly WireEntry[] {
  const entries: WireEntry[] = [];
  for (let index = picks.length - 1; index >= 0 && entries.length < DRAFT_ROOM_CONFIG.wire.maxItems; index--) {
    const pick = picks[index]!;
    const player = playersById.get(pick.playerId);
    if (player !== undefined) entries.push({ pick, player });
  }
  return entries;
}

/**
 * THE ROOM WIRE (2026-08-26 design review, R1) — the front-door `Wire`'s idiom
 * (`src/league-room/components/wire.tsx`) at room scale: one hairline-topped, mono-voiced band
 * that whispers the draft's own history instead of scrolling anonymous product news. Newest
 * pick first, every item quiet (`text-text-muted`) except the player name of the NEWEST pick,
 * which carries ink (`text-text-primary font-semibold`) — one fact stands out, the rest recede,
 * so the wire never competes with `PickCelebration`'s own landing moment for attention.
 *
 * No animation: rule 6 reserves motion for things that are actually happening, and a list that
 * only ever gains an item at its head has nothing to animate that `PickCelebration` doesn't
 * already carry. An auction pick renders identically to a snake pick — a completed pick is a
 * completed pick regardless of format, and `CompletedPick.price` has no place in a one-line
 * history (`budget-table` already owns money).
 *
 * The band's slot is reserved from the moment the room mounts, never only once a pick exists —
 * the same fixed-height law `RoomShell`'s own stage-notices slot keeps (D2, 2026-08-26 design
 * review): a band that only appears once nonempty would shove the board down by its own height
 * on the very first pick, the exact reflow the room forbids. `data-testid="pick-wire"` always
 * renders at a fixed `h-8`; only its content is conditional on `view.picks` being nonempty.
 */
export function PickWire({ view, teams, playersById, players, variant = "room" }: PickWireProps) {
  const entries = wireEntries(view.picks, playersById);
  const teamsMap = teamsById(teams);
  // Task 7: the verdict rides the NEWEST pick only. That item is already the one carrying ink
  // (this band's own "one fact stands out" rule), it is the one that just happened, and a chip
  // on all six would turn a quiet one-line history into a scoreboard the band has no width for.
  const population = verdictPopulation(players, view.picks);

  return (
    <div
      data-testid="pick-wire"
      // `min-w-0` beside `truncate`: `truncate` clips what overflows, but this band is a flex
      // ITEM in the room's and the TV's column and a flex item's automatic minimum size is its
      // CONTENT, so six un-wrapping mono pick items could stretch the column itself. Belt and
      // braces on the one band whose content length is unbounded — the 360px sweep this pass ran
      // found the real page-level leaks elsewhere (`mock-results.tsx`'s grid items and
      // `draft-board.tsx`'s narrow list), but this is the same class of bug one paste away.
      className={`h-8 min-w-0 shrink-0 truncate border-t border-line font-mono leading-8 text-text-muted ${TEXT_SIZE[variant]}`}
    >
      {entries.length === 0 ? null : (
        <ul aria-label="Recent picks" className="inline">
          {entries.map(({ pick, player }, index) => (
            <li key={pick.pickNumber} className="inline">
              {index > 0 ? <span aria-hidden="true"> · </span> : null}
              {/* A colon, not the em dash this band used to carry: the house copy rule bans both
                  dash characters outright (`@/integrity/copy-rules`), and a wire item reads as a
                  label and its value anyway. */}
              {`#${pick.pickNumber} ${teamName(teamsMap, pick.teamId)}: `}
              {/* Task 3: room-variant names are pressable; the TV keeps every control inert
                  (standing law), so it never receives `PlayerName`'s button. */}
              {variant === "room" ? (
                <PlayerName
                  leagueId={view.leagueId}
                  playerId={player.id}
                  name={player.name}
                  className={`inline ${index === 0 ? "font-semibold text-text-primary" : ""}`}
                />
              ) : (
                <span className={index === 0 ? "font-semibold text-text-primary" : undefined}>{player.name}</span>
              )}{" "}
              <PositionBadge position={player.position} size={BADGE_SIZE[variant]} />
              {index === 0 ? (
                <>
                  {" "}
                  <VerdictChip verdict={verdictForPick(population, pick)} />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
