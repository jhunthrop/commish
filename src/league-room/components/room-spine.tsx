import Link from "next/link";
import { PlayerFace } from "@/components/ui";
import type { FixtureLabel } from "@research/reference/nfl-schedule";
import type { LineupBody, LineupSlotView } from "../contract";
import { playerOf } from "../lib/player";

export interface RoomSpineProps {
  readonly leagueId: string;
  readonly lineup: LineupBody | null;
  readonly fixturesByNflTeam: ReadonlyMap<string, FixtureLabel>;
  readonly projectionsByPlayerId: ReadonlyMap<string, number>;
}

/** Designations that read as "will not play" — mirrors `lineup-problems.ts`'s set for the one
 *  glyph the spine has room for. */
const OUT_DESIGNATIONS: ReadonlySet<string> = new Set(["O", "IR", "PUP", "NFI", "SUS"]);

type SpineNote =
  | { readonly kind: "bye" }
  | { readonly kind: "out" }
  | { readonly kind: "projection"; readonly value: number }
  | { readonly kind: "none" };

function noteFor(
  slot: LineupSlotView,
  fixtures: ReadonlyMap<string, FixtureLabel>,
  projections: ReadonlyMap<string, number>,
): SpineNote {
  if (slot.playerId === null) return { kind: "none" };
  if (slot.nflTeam !== null && !fixtures.has(slot.nflTeam)) return { kind: "bye" };
  const designation = slot.injuryDesignation ?? null;
  if (designation !== null && OUT_DESIGNATIONS.has(designation)) return { kind: "out" };
  const projection = projections.get(slot.playerId);
  return projection === undefined ? { kind: "none" } : { kind: "projection", value: projection };
}

function isLiveNow(slot: LineupSlotView, fixtures: ReadonlyMap<string, FixtureLabel>): boolean {
  return slot.nflTeam !== null && fixtures.get(slot.nflTeam)?.status === "in_progress";
}

/**
 * THE ROSTER SPINE — the rail that keeps the viewer's lineup in the corner of their eye on every
 * stage. This week's projection under each man, BYE and OUT called out in the loss channel, a live
 * tick while a starter's game runs. The whole rail is one link to the team page, where the full
 * editor lives.
 *
 * FACES, NOT STICKERS (Sideline, 2026-09-10). The rail used to be nine position stickers — "QB",
 * "RB", "FLX" — which is a column of codes standing in for nine people, and P1 rules it out by
 * name ("initials-only avatars where a face exists"). It is now nine 36px faces on their clubs'
 * rings (`TOKENS.density.facePx`, `PlayerFace size="md"`), which is the same width and reads as
 * your team rather than as a slot chart. An EMPTY slot keeps a dashed ring and the slot's own
 * letter, because there is nobody there to draw and the word is the only honest thing to print.
 */
export function RoomSpine({ leagueId, lineup, fixturesByNflTeam, projectionsByPlayerId }: RoomSpineProps) {
  if (lineup === null) return null;
  return (
    <Link
      href={`/app/leagues/${leagueId}/team`}
      aria-label="Your roster. Open your team page."
      className="hidden w-14 shrink-0 flex-col items-center gap-2 border-r border-line bg-surface-elevated py-3 hover:bg-surface-raised md:flex"
    >
      {lineup.starters.map((slot) => {
        const note = noteFor(slot, fixturesByNflTeam, projectionsByPlayerId);
        const player = playerOf(slot);
        return (
          <span key={`${slot.slot}-${slot.slotIndex}`} className="flex flex-col items-center gap-0.5">
            <span className="relative flex items-center justify-center">
              {player === null ? (
                <span className="flex size-9 items-center justify-center rounded-pill border border-dashed border-edge font-display text-[10px] font-bold text-text-faint">
                  {slotWord(slot.slot)}
                </span>
              ) : (
                <PlayerFace player={player} size="md" />
              )}
              {isLiveNow(slot, fixturesByNflTeam) ? (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-live" aria-hidden />
              ) : null}
            </span>
            {note.kind === "projection" ? (
              <span className="font-mono text-[9px] leading-none text-text-faint">{note.value.toFixed(1)}</span>
            ) : note.kind === "bye" ? (
              <span className="font-display text-[9px] font-semibold leading-none text-negative">Bye</span>
            ) : note.kind === "out" ? (
              <span className="font-display text-[9px] font-semibold leading-none text-negative">Out</span>
            ) : (
              <span className="font-mono text-[9px] leading-none text-text-faint">·</span>
            )}
          </span>
        );
      })}
      <span className="my-1 w-6 border-t border-line" aria-hidden />
      {lineup.bench.map((slot) => {
        const player = playerOf(slot);
        return player === null ? (
          <span
            key={`bench-${slot.slotIndex}`}
            className="flex size-7 items-center justify-center rounded-pill border border-dashed border-line font-display text-[10px] font-semibold text-text-faint"
            aria-hidden
          >
            B
          </span>
        ) : (
          <span key={`bench-${slot.slotIndex}`} className="opacity-70">
            <PlayerFace player={player} size="sm" />
          </span>
        );
      })}
      <span
        className="mt-auto rotate-180 text-[9px] tracking-widest text-text-faint [writing-mode:vertical-rl]"
        aria-hidden
      >
        Your roster · tap to open
      </span>
    </Link>
  );
}

/** The slot's own short name, for the one case with no face to draw. */
function slotWord(slot: string): string {
  if (slot === "BENCH") return "BN";
  if (slot === "SUPERFLEX") return "SF";
  if (slot === "FLEX") return "FLX";
  return slot;
}
