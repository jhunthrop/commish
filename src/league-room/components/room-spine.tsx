import Link from "next/link";
import { positionStickerClass } from "@/components/ui/position-badge";
import type { FixtureLabel } from "@/league-service/nfl-schedule";
import type { LineupBody, LineupSlotView } from "../contract";

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
 * THE ROSTER SPINE — the 44px rail that keeps the viewer's lineup in the corner of their eye on
 * every stage. Position stickers with this week's projection under each, BYE and OUT called out
 * in the loss channel, a live tick while a starter's game runs. The whole rail is one link to
 * the team page, where the full editor lives.
 */
export function RoomSpine({ leagueId, lineup, fixturesByNflTeam, projectionsByPlayerId }: RoomSpineProps) {
  if (lineup === null) return null;
  return (
    <Link
      href={`/app/leagues/${leagueId}/team`}
      aria-label="Your roster. Open your team page."
      className="hidden w-12 shrink-0 flex-col items-center gap-2 border-r border-line bg-surface-elevated py-3 hover:bg-surface-raised md:flex"
    >
      {lineup.starters.map((slot) => {
        const note = noteFor(slot, fixturesByNflTeam, projectionsByPlayerId);
        return (
          <span key={`${slot.slot}-${slot.slotIndex}`} className="flex flex-col items-center gap-0.5">
            <span
              className={`relative flex h-7 w-8 items-center justify-center rounded-sm font-display text-xs font-semibold ${
                slot.position === null
                  ? "border border-line text-text-faint"
                  : positionStickerClass(slot.position)
              }`}
            >
              {slot.slot === "BENCH" ? "B" : slot.slot === "SUPERFLEX" ? "SF" : slot.slot === "FLEX" ? "FLX" : slot.slot}
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
      {lineup.bench.map((slot) => (
        <span
          key={`bench-${slot.slotIndex}`}
          className="flex h-6 w-8 items-center justify-center rounded-sm border border-line font-display text-[10px] font-semibold text-text-faint"
          aria-hidden
        >
          B
        </span>
      ))}
      <span
        className="mt-auto rotate-180 text-[9px] tracking-widest text-text-faint [writing-mode:vertical-rl]"
        aria-hidden
      >
        Your roster · tap to open
      </span>
    </Link>
  );
}
