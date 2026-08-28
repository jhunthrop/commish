"use client";

import { useMemo, useState } from "react";
import type { Player, Position } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { Badge, Button, Card, EmptyState, Input, PositionBadge } from "@/components/ui";
import { queueButtonLabel } from "../lib/lookups";
import { verdictFor, verdictPopulation } from "../lib/verdict";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { PlayerFace } from "@/components/ui/player-face";
import { VerdictChip } from "./verdict-chip";

const ALL = "ALL";
const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

export interface PlayerPoolProps {
  /** Server-ranked, best first. This component never re-ranks. */
  readonly players: readonly Player[];
  readonly view: DraftStateView;
  readonly pendingPlayerId: string | null;
  /** True only when the server says it is this user's turn to act. */
  readonly canAct: boolean;
  /**
   * The caller's own team, or null when watching. Task 5's own use: a team that owes a pick may
   * make it any time, whether or not `canAct` (this team's REAL current turn) is also true — the
   * Draft button lives on their turn and off it.
   */
  readonly myTeamId: string | null;
  /** "Draft" for snake, "Nominate" for auction. */
  readonly actionLabel: string;
  readonly submitting: boolean;
  readonly onAct: (playerId: string) => void;
  readonly queuedPlayerIds: ReadonlySet<string>;
  readonly onQueue: (playerId: string) => void;
}

interface PoolRow {
  readonly player: Player;
  readonly rank: number;
  readonly drafted: boolean;
}

/**
 * The position filters, as the same stickers the board is made of. Toggles rather than a
 * `<select>` because narrowing to "just the running backs" is the single most-used gesture in
 * a draft, and it should cost one tap, not two plus a scroll. `aria-pressed` is what makes
 * them real toggles to a screen reader rather than six unlabelled buttons.
 */
function PositionFilters({ value, onChange }: { readonly value: string; readonly onChange: (next: string) => void }) {
  return (
    <div role="group" aria-label="Filter by position" className="flex flex-wrap items-center gap-1">
      {/* Secondary when selected, ghost when not — never primary: a filter is not the room's
          one ink action (D3, rule 5). The outline alone says "this is the active toggle". */}
      <Button
        size="sm"
        variant={value === ALL ? "secondary" : "ghost"}
        aria-pressed={value === ALL}
        onClick={() => onChange(ALL)}
      >
        All
      </Button>
      {POSITIONS.map((position) => (
        // A bare toggle, not a padded Button: seven chips must sit on one rail row, and the
        // sticker badge already is the visual — button chrome around it was pure width.
        // Task 13's own axe pass caught the previous `opacity-80` inactive treatment for real:
        // `PositionBadge` is white text on a solid sticker fill, verified ≥4.5:1 at FULL opacity
        // only (`tokens.test.ts`) — dimming the whole button toward the room's own (light-theme)
        // near-white ground washes the fill toward that ground faster than it washes the text,
        // closing the gap for RB and TE specifically. The ring alone (already the selected
        // state's own signal) is what tells the six stickers apart from "no ring", the same
        // accent/ghost distinction the "All" button beside them already uses — no dimming
        // anywhere means no theme can ever wash a sticker's own contrast out again.
        <button
          key={position}
          type="button"
          aria-pressed={value === position}
          aria-label={`Show ${position} only`}
          className={`rounded-sm p-0.5 focus-visible:outline-2 focus-visible:outline-accent ${value === position ? "ring-2 ring-accent" : ""}`}
          onClick={() => onChange(value === position ? ALL : position)}
        >
          <PositionBadge position={position} size="sm" />
        </button>
      ))}
    </div>
  );
}

/**
 * The pool, as the room's left-hand rail: search, position stickers, and one compact row per
 * player. A list rather than a `Table` — at rail width there are no columns worth aligning,
 * and the row's meaning is "this player, and the two things I can do with him".
 *
 * The star is the queue toggle; the button beside it is the act. Both are real, named
 * controls, so the whole pool is walkable from the keyboard.
 */
export function PlayerPool({ players, view, pendingPlayerId, canAct, myTeamId, actionLabel, submitting, onAct, queuedPlayerIds, onQueue }: PlayerPoolProps) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState(ALL);
  // Task 5: a team that owes a pick may make it any time, so the row-level Draft button below
  // is live for them even when `canAct` (this team's REAL current turn) is false.
  const owesPick = myTeamId !== null && (view.owedPicks?.[myTeamId]?.length ?? 0) > 0;
  const canDraft = canAct || owesPick;
  // A live pool's one job is "who can I take" — drafted names hide unless asked for.
  const [showDrafted, setShowDrafted] = useState(false);

  const available = useMemo(() => new Set(view.availablePlayerIds), [view.availablePlayerIds]);
  // Before START_DRAFT the engine has no pool yet, so `availablePlayerIds` is empty — which is
  // "we don't know yet", NOT "everybody is drafted". Showing a board of "Drafted" badges to a
  // manager waiting on their commissioner was the single most confusing thing in the room.
  const preStart = view.phase === "scheduled";
  // A verdict compares a slot against a board, and neither exists until the draft is running.
  const live = view.phase === "in_progress";
  // The full match set, before the page-size cap below — its length is what tells the
  // truncation notice how many rows are hidden.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return players
      .map((player, index): PoolRow => ({ player, rank: index + 1, drafted: !preStart && !available.has(player.id) }))
      .filter((row) => (position === ALL || row.player.position === position) && (needle === "" || row.player.name.toLowerCase().includes(needle)))
      .filter((row) => showDrafted || !row.drafted);
  }, [players, available, preStart, query, position, showDrafted]);
  const rows = useMemo(() => filtered.slice(0, DRAFT_ROOM_CONFIG.poolPageSize), [filtered]);
  const truncated = filtered.length > DRAFT_ROOM_CONFIG.poolPageSize;
  // TASK 7, THE VERDICT, in the pool: "if I took him at this slot, how would that compare to the
  // picks this room has already made?" Built once per render pass, never per row — sixty rows
  // each rebuilding it would be sixty scans of the same pick log.
  const verdicts = useMemo(() => verdictPopulation(players, view.picks), [players, view.picks]);

  return (
    // `id="player-pool"` (review E3): the dock's below-`lg` "Jump to the pool" affordance
    // (`RoomDock`) scrolls straight to this element — the pool's own root, so the jump lands on
    // the search box, not somewhere mid-list.
    <section id="player-pool" aria-label="Player pool" className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-col gap-2">
        <Input label="Search players" value={query} placeholder="Name" onChange={(event) => setQuery(event.target.value)} />
        <PositionFilters value={position} onChange={setPosition} />
        {preStart ? null : (
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input type="checkbox" checked={showDrafted} onChange={(event) => setShowDrafted(event.target.checked)} />
            Show drafted players
          </label>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No players match"
          description="Try a different name or position."
          icon="search"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery("");
                setPosition(ALL);
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <ol aria-label="Available players, best first" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {rows.map((row) => {
            const queued = queuedPlayerIds.has(row.player.id);
            // STEALS ONLY, and only while the draft is actually running. A pool row is a
            // PROSPECT, not a pick: at any slot, everybody ranked below that slot is trivially a
            // "reach", so the un-filtered verdict painted fifty-four red chips down a sixty-row
            // rail — saying nothing, fifty-four times, which is precisely the decoration rule 6
            // rejects. A player still sitting there LATER than his own rank is the one thing
            // worth calling out here, and it is the fact a manager scanning the pool is hunting
            // for. The pick wire and the results log show both verdicts, because those judge
            // picks that actually happened.
            const verdict = row.drafted || !live ? null : verdictFor(verdicts, row.rank, view.pickNumber);
            const steal = verdict !== null && verdict.kind === "steal" ? verdict : null;
            return (
              // RULE 4'S AMENDED TEST (`docs/design-system.md`): a thing you act on or compare
              // against its neighbours may be a card. A pool row is both — you read three of them
              // against each other and then draft one — which is exactly the case the amendment
              // names. `interactive` only while there is something to act on: a drafted row lifts
              // for nobody.
              <Card
                as="li"
                padding="compact"
                interactive={!row.drafted}
                key={row.player.id}
                className={`flex shrink-0 flex-col justify-center gap-1 ${row.drafted ? "opacity-60" : ""}`}
              >
                {/* V-04 (veteran journey, BLOCKER): the name used to share ONE row with the
                    rank, sticker, avatar, team code, queue star and act button — every one of
                    those has a natural, non-shrinking minimum width, so the only element that
                    could ever give up space (`min-w-0 flex-1 truncate`) absorbed the ENTIRE
                    deficit and collapsed to 3-4 characters the instant a "Draft"/"Nominate"
                    button appeared beside it, on a 60-second clock, where you cannot pick a
                    player you cannot read. The name now owns its own line at the row's full
                    width — nothing else competes with it for space, so it truncates only a
                    genuinely long name, never first and never most. */}
                <div className="flex min-w-0 items-center gap-2">
                  <span className="w-5 shrink-0 text-right font-mono text-xs tabular-nums text-text-muted">{row.rank}</span>
                  <PositionBadge position={row.player.position} size="sm" />
                  {/* Founder directive 2026-08-26 ("why aren't we showing the players picture?"),
                      now on the club's own colour (rule 1's team-identity amendment, Task 8).
                      Decorative — the name right beside it already says who this is. */}
                  {/* `sm` explicitly: the pool is sixty rows in a 320px rail, the density this
                      face was originally built at, and the primitive's default is now the
                      card-and-roster step rather than this one. */}
                  <PlayerFace player={row.player} size="sm" />
                  <span data-testid="pool-player-name" className="min-w-0 flex-1 truncate font-display font-semibold text-text-primary">{row.player.name}</span>
                  <VerdictChip verdict={steal} />
                </div>
                {/* The meta row: the team code (no longer fighting the name for width, so it no
                    longer needs the laptop-fit `xl:` gate — it fits on its own line at the
                    320px rail floor) on the left, and the fixed action column on the right —
                    the star and the act control never move, whichever state they're in. */}
                <div className="flex items-center justify-between gap-2 pl-7">
                  <span data-testid="pool-player-team" className="min-w-0 truncate text-xs text-text-muted">{row.player.nflTeam}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    {row.drafted ? null : (
                      <Button size="sm" variant="ghost" disabled={submitting} aria-label={queueButtonLabel(row.player.name, queued)} onClick={() => onQueue(row.player.id)}>
                        <span aria-hidden="true" className={queued ? "text-accent" : "text-text-muted"}>
                          {queued ? "★" : "☆"}
                        </span>
                      </Button>
                    )}
                    {preStart ? (
                      // Nothing at all — E11 (2026-08-26 design review): a per-row "—" printed a
                      // 60-row column of dashes before kickoff. There is nothing to do here yet,
                      // the rail says why, and the star beside this slot is still the whole story.
                      null
                    ) : row.drafted ? (
                      <Badge tone="neutral">Drafted</Badge>
                    ) : canDraft ? (
                      // Picking mode: the act button exists while it is genuinely your turn, OR
                      // (Task 5) while you owe a pick from an earlier skip — live on your turn
                      // and off it. While neither is true, the star is the action — a disabled
                      // "Draft" would be a lie-in-waiting.
                      //
                      // INK, as of the fun pass (Task 8). This was `secondary` under D3
                      // (2026-08-26), which read rule 5 as binding here: sixty ink pills against
                      // a one-ink-action law. Rule 5 has since been amended
                      // (`docs/design-system.md`, "The fun-pass amendments") to hold everywhere
                      // EXCEPT surfaces whose entire purpose is repeated action, and it names the
                      // draft room first. The row is where a manager drafts, so the row is where
                      // the ink belongs; a quiet pill beside a loud dock taught people to hunt
                      // for the dock instead of pressing the thing they were already looking at.
                      // `e2e/page-audit.spec.ts` still enforces one ink action on every route it
                      // audits, and the draft room is deliberately not one of them.
                      <Button
                        size="sm"
                        loading={submitting && pendingPlayerId === row.player.id}
                        onClick={() => onAct(row.player.id)}
                      >
                        {actionLabel}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </ol>
      )}

      {truncated ? (
        <p className="shrink-0 text-sm text-text-muted">
          Showing the top {rows.length} of {filtered.length}. Narrow your search to see more.
        </p>
      ) : null}
    </section>
  );
}
