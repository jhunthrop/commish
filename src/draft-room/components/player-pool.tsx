"use client";

import { Fragment, useMemo, useState } from "react";
import type { Player, Position } from "@research-ts/domain/player";
import type { DraftStateView } from "@/draft-engine";
import type { Law } from "@research-ts/projections/laws/types";
import type { BoardReason } from "@research-ts/projections/preseason/board";
import { Badge, Button, EmptyState, Input, Movement, PlayerRow, PositionBadge, ReasonChip, RosterStatusPill, TierDivider, strongestLawReasons } from "@/components/ui";
import { rosterStatusNoteOf } from "@research-ts/projections/preseason/roster-status";
import { MICRO_LABEL } from "@/components/ui/config";
import { queueButtonLabel } from "../lib/lookups";
import { marketOrderNoteFor } from "../lib/market-order-note";
import { formatAdp, poolTiers, positionRanks } from "../lib/tiers";
import { verdictFor, verdictPopulation } from "../lib/verdict";
import { DRAFT_ROOM_CONFIG } from "../state/config";
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
  /**
   * The league's own seat count, for the tier ladder's grades (a consensus ROUND is a fact about
   * a room of a given size — see `../lib/tiers`). Passed rather than read off
   * `view.draftOrder.length` alone because the draft order does not exist until the draft starts,
   * and the pre-kickoff room is exactly when a manager is studying the board. The view's order
   * still wins once it exists: it is the seating this draft actually drew.
   */
  readonly teamCount: number;
  /**
   * The board's own law-backed reasons, keyed by the same `playerId` `players` carries — the same
   * map `DraftBoard` already threads to its stickers (Task 8's `boardReasons`, via the pool API's
   * `reasons` field). `null`/omitted renders every row exactly as before this prop existed: a
   * board with no reasons (a season with no confirmed law, a not-yet-ranked pool) is not an error
   * state here, matching `DraftBoard`'s own contract for the same data.
   */
  readonly reasons?: ReadonlyMap<string, readonly BoardReason[]> | null;
  /** The law registry, for `ReasonChip`'s own `sr-only` elaboration — plain data, read
   *  server-side (`registry()` never reaches the browser) and threaded alongside `reasons`. */
  readonly laws?: readonly Law[];
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
      {/* Secondary when selected, ghost when not — never `verb` and never `primary`: a filter is
          not an ACT, and law 5's whole discipline is that the loud action belongs to acts only.
          The outline alone says "this is the active toggle". */}
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
 * THE POOL, as a tiered board of player objects — laws 1, 3, 4 and 5 in one column, and the
 * surface this room's Gameday pass moved furthest.
 *
 * WHAT IT WAS. Sixty two-line bordered cards, each ~90px tall, each carrying a rank, a sticker, a
 * face, a name, a team code and an INK pill. Eight players fitted on a 1000px screen, the tallest
 * thing in the column was a card border, and the only number anywhere was a 12px ordinal. On a
 * sixty-second clock that is a seven-screen scroll through a list with no landmarks in it.
 *
 * WHAT IT IS. `PlayerRow` (the law-3 atom) at one row per player, a `TierDivider` wherever the
 * consensus board genuinely steps down, each player's own ADP printed beside his team code, and
 * the act on every row as `verb` — money-filled, `rounded-md`, repeated as many times as the
 * screen repeats the act, which is exactly what law 5 replaced "one ink action per view" to
 * permit. Four changes, one argument: **a draft board is a ladder you climb, and the old pool was
 * a list you read.**
 *
 * WHY THE VERB IS NOT THE INK PILL ANY MORE. It was `primary` from the fun pass onward, which was
 * right against v3's rule 5 and is wrong against Gameday's law 5: *"`primary` is ceremonial — one
 * per view, the thing a page exists to do once… `verb` is the thing a board does forty times."*
 * Sixty white ink pills down a rail read as sixty ceremonies; sixty money pills read as one board
 * you can act on anywhere. `Button`'s own variant carries the whole change — nothing here spells
 * a fill.
 *
 * THE TIERS SURVIVE FILTERING BECAUSE THEY ARE NOT COMPUTED FROM THE FILTER. `poolTiers` runs
 * once over the whole ranked pool (`../lib/tiers`), and this list draws a divider wherever two
 * adjacent VISIBLE rows carry different band ids. Filter to running backs and the ladder still
 * says which tier each survivor came out of — including the case that matters most, a band with
 * one man left in it.
 *
 * The star is the queue toggle; the button beside it is the act. Both are real, named controls,
 * so the whole pool is walkable from the keyboard.
 */
export function PlayerPool({
  players,
  view,
  pendingPlayerId,
  canAct,
  myTeamId,
  actionLabel,
  submitting,
  onAct,
  queuedPlayerIds,
  onQueue,
  teamCount,
  reasons = null,
  laws = [],
}: PlayerPoolProps) {
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
  const marketOrderNote = position === ALL ? null : marketOrderNoteFor(position as Position);
  // TASK 7, THE VERDICT, in the pool: "if I took him at this slot, how would that compare to the
  // picks this room has already made?" Built once per render pass, never per row — sixty rows
  // each rebuilding it would be sixty scans of the same pick log.
  const verdicts = useMemo(() => verdictPopulation(players, view.picks), [players, view.picks]);
  // The ladder, over the WHOLE board rather than the filtered view — see the docblock. Keyed on
  // the room's own seat count, because a consensus round is a fact about a room of that size.
  const seats = view.draftOrder.length > 0 ? view.draftOrder.length : teamCount;
  const tiers = useMemo(() => poolTiers(players, seats), [players, seats]);
  // "RB4" on the sticker rather than a rank column: the board is already ranked best-first, so the
  // fourth running back down it IS this board's RB4, and the fact costs no width to say. Built
  // over the whole board, never the filtered view — see `positionRanks`.
  const ranks = useMemo(() => positionRanks(players), [players]);

  // Law 2, in the one place the pool has an honest number for it: how many players the filter
  // currently leaves standing. `filtered.length`, not the pool size — the figure answers the
  // question a manager is actually asking while he narrows ("how thin is this position getting"),
  // and it moves as the room drafts.
  const standing = filtered.length;

  return (
    // `id="player-pool"` (review E3): the dock's below-`lg` "Jump to the pool" affordance
    // (`RoomDock`) scrolls straight to this element — the pool's own root, so the jump lands on
    // the search box, not somewhere mid-list.
    <section id="player-pool" aria-label="Player pool" className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-col gap-2">
        <Input label="Search players" value={query} placeholder="Name" onChange={(event) => setQuery(event.target.value)} />
        {/* The seven stickers own their own line: at a 320px rail they are already one row
            exactly, and anything sharing it pushed two of them onto a second line. */}
        <PositionFilters value={position} onChange={setPosition} />
        <div className="flex items-center justify-between gap-2">
          {preStart ? (
            <span />
          ) : (
            // A real toggle with a real boundary, not a bare `<input type="checkbox">`: it is the
            // same `aria-pressed` vocabulary as the position stickers above it, so the pool's
            // filter controls speak one grammar rather than two.
            <Button
              size="sm"
              variant={showDrafted ? "secondary" : "ghost"}
              aria-pressed={showDrafted}
              onClick={() => setShowDrafted((shown) => !shown)}
            >
              Show drafted players
            </Button>
          )}
          {/* The mock's own `248 LEFT` — a mono figure and a shouted micro-label, the one
              register the caps charter still permits capitals in. No `Stat`: there is no
              population a remaining-player count falls inside, and a number is never coloured
              for looking big. */}
          <span className="flex shrink-0 items-baseline gap-1">
            <span data-testid="pool-standing-count" className="font-mono text-md font-semibold tabular-nums text-text-primary">
              {standing}
            </span>
            <span className={`${MICRO_LABEL} text-text-faint`}>left</span>
          </span>
        </div>
        {/* A position the engine publishes no projection for says so, once, above its own rows.
            Only while a single position is selected: the note is about THAT position, and printing
            it over the mixed list would attach a claim to rows it is not about. */}
        {marketOrderNote === null ? null : (
          <p data-testid="market-order-note" className="rounded-sm bg-surface-inset px-3 py-2 text-xs text-text-muted">
            {marketOrderNote}
          </p>
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
          {rows.map((row, index) => {
            const queued = queuedPlayerIds.has(row.player.id);
            // STEALS ONLY, and only while the draft is actually running. A pool row is a
            // PROSPECT, not a pick: at any slot, everybody ranked below that slot is trivially a
            // "reach", so the un-filtered verdict painted fifty-four red chips down a sixty-row
            // rail — saying nothing, fifty-four times, which is precisely the decoration law 6
            // rejects. A player still sitting there LATER than his own rank is the one thing
            // worth calling out here, and it is the fact a manager scanning the pool is hunting
            // for. The pick wire and the results log show both verdicts, because those judge
            // picks that actually happened.
            const verdict = row.drafted || !live ? null : verdictFor(verdicts, row.rank, view.pickNumber);
            const steal = verdict !== null && verdict.kind === "steal" ? verdict : null;
            // LAW 1, IN THE ONE COLUMN THAT WAS EMPTY (Sunday v5): where our board disagrees with
            // the market, and by how many places. `players` arrives server-ranked best-first, so
            // `row.rank` IS our rank; `adp` is the room's consensus. The gap between two REAL
            // rankings is the only figure on this row that carries chroma — the ADP itself stays
            // grey in the meta line, because a value with no comparison behind it is a fact.
            //
            // Rounded to whole places, because the claim is "nine spots higher than the room has
            // him", not a decimal. A player the feed does not rank has no comparison at all and
            // gets nothing (law 7).
            //
            // A ZERO GAP RENDERS NOTHING, for the same reason `VerdictChip` declines to print
            // "0 even": agreeing with the market is the absence of a verdict, and the pool has
            // already learned once (E11) what a sixty-row column of em-dashes costs. `Movement`
            // itself draws the dash where a caller genuinely wants "unchanged" on screen; this
            // caller does not.
            const rawGap = row.player.adp === null ? null : Math.round(row.player.adp) - row.rank;
            const marketGap = rawGap === 0 ? null : rawGap;
            const tier = tiers.get(row.player.id) ?? null;
            const previousTier = index === 0 ? null : (tiers.get(rows[index - 1]!.player.id) ?? null);
            // A divider opens a band, so it draws on the FIRST visible row of one — including
            // the very first row in the list, which is what makes the top of the board carry its
            // own grade instead of inheriting it silently from a row nobody can see. A player the
            // feed does not rank ends the ladder rather than opening an unlabelled band.
            const opensBand = tier !== null && (previousTier === null || previousTier.id !== tier.id);
            const adp = formatAdp(row.player.adp);
            // Task (rankings surface): strongest |effect| first, capped at two, same rule and
            // same helper `StickerCell` uses — spend the "why" emphasis once, in one place, per
            // Sunday v5 law 4. `null`/absent `reasons` and an unranked player both resolve to "no
            // chips", which is what leaves this row's height untouched (see `PlayerRow.chips`).
            const lawChips = strongestLawReasons(reasons?.get(row.player.id) ?? []);
            // The roster-status gate (2026-09-08): the board's own dated status, from the same
            // reason list the chips read, in the same pill every other surface shows.
            const rosterStatus = rosterStatusNoteOf(reasons?.get(row.player.id) ?? []);
            return (
              // A fragment, never a wrapper element: an `<ol>` may hold only list items, and a
              // band divider is a sibling `<li>` of the rows it opens rather than a `<div>`
              // smuggled between them.
              <Fragment key={row.player.id}>
                {opensBand ? (
                  <li className="mt-1 shrink-0 first:mt-0">
                    <TierDivider grade={tier.grade} label={tier.label} />
                  </li>
                ) : null}
                <li data-pool-row="true" className={`shrink-0 ${row.drafted ? "opacity-60" : ""}`}>
                  <PlayerRow
                    player={row.player}
                    positionRank={ranks.get(row.player.id)}
                    highlight={queued && !row.drafted}
                    meta={
                      <>
                        <span data-testid="pool-player-team">{row.player.nflTeam}</span>
                        {adp === null ? null : <span data-testid="pool-player-adp">{` · ${adp}`}</span>}
                        {rosterStatus === null ? null : <RosterStatusPill note={rosterStatus} className="ml-1.5" />}
                      </>
                    }
                    chips={
                      lawChips.length === 0 ? null : (
                        <>
                          {lawChips.map((reason) => (
                            <ReasonChip key={reason.lawId} reason={reason} registry={laws} />
                          ))}
                        </>
                      )
                    }
                    // A steal is a judgement about THIS MOMENT and outranks the standing market
                    // gap: once the board has run past a man's own rank, "still here at pick 44"
                    // is the fact worth the column. Everywhere else the column carries the gap,
                    // which is the product's whole thesis stated sixty times without a word.
                    verdict={steal !== null ? <VerdictChip verdict={steal} /> : marketGap === null ? null : <Movement places={marketGap} against="ADP" />}
                    action={
                      <div className="flex items-center gap-1">
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
                          // Law 5's own variant. Live while it is genuinely your turn, OR (Task 5)
                          // while you owe a pick from an earlier skip. While neither is true the
                          // star is the action — a disabled "Draft" would be a lie-in-waiting.
                          <Button
                            size="sm"
                            variant="verb"
                            loading={submitting && pendingPlayerId === row.player.id}
                            onClick={() => onAct(row.player.id)}
                          >
                            {actionLabel}
                          </Button>
                        ) : null}
                      </div>
                    }
                  />
                </li>
              </Fragment>
            );
          })}
        </ol>
      )}

      {truncated ? (
        <p className="shrink-0 font-mono text-xs tabular-nums text-text-muted">
          Showing the top {rows.length} of {filtered.length}. Narrow your search to see more.
        </p>
      ) : null}
    </section>
  );
}
