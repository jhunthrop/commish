"use client";

import type { TeamCard } from "@/domain/league";
import type { Player } from "@/domain/player";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import type { Law } from "@/projections/laws/types";
import type { BoardReason } from "@/projections/preseason/board";
import { Avatar, Badge, EYEBROW, ReasonChip, Sticker, strongestLawReasons } from "@/components/ui";
import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { plural } from "@/domain/duration";
import { PlayerName } from "@/league-room/components/player-peek";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { rosterSpots } from "../state/format";
import { teamName, teamsById } from "../lib/lookups";

export type DraftBoardVariant = "room" | "tv";

export interface DraftBoardProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string | null;
  /** The pick that just landed. Its sticker slaps onto the board; everything else is static. */
  readonly landedPickNumber?: number | null;
  /** `tv` is the same board at party scale: bigger stickers, bigger lettering. */
  readonly variant?: DraftBoardVariant;
  /**
   * The mock lane's own words for a bot seat (Task 8, Step 1) — `null` for a real draft, which
   * renders no marker at all and is otherwise byte-identical to before this task. Two strings,
   * not a boolean: this board never imports `@/mock-draft` itself (the client boundary), so
   * `MOCK_COPY.botMarkerLabel`/`botBadge` arrive as data from `DraftRoom`, which read them off
   * `room.mock` — see `MockRoomInfo`'s own docblock (`../contract`).
   */
  readonly mock?: { readonly botMarkerLabel: string; readonly botBadge: string } | null;
  /**
   * Task 8: the board's own law-backed reasons, keyed by the SAME `playerId` `playersById` uses
   * — threaded from the pool API's `reasons` field, which is itself `boardReasons` for the
   * current season's `BOARD_SOURCE` (see `src/app/api/drafts/[draftId]/players/route.ts`).
   * `null`/omitted renders every sticker exactly as before this task: a board with no reasons
   * (a season with no confirmed law, a not-yet-ranked pool) is not an error state here.
   */
  readonly reasons?: ReadonlyMap<string, readonly BoardReason[]> | null;
  /** The law registry, for `ReasonChip`'s own `sr-only` elaboration — plain data, read
   *  server-side (`registry()` never reaches the browser) and threaded alongside `reasons`. */
  readonly laws?: readonly Law[];
}

interface BoardCell {
  readonly teamId: string;
  readonly pick: CompletedPick | null;
  readonly onClock: boolean;
  readonly future: boolean;
  /** True when this row is the SLOT a skip left open (Task 5) — `view.owedPicks[teamId]`
   *  names the pick numbers, never the round, so this is that number's own round. */
  readonly pending: boolean;
}

interface BoardRow {
  readonly round: number;
  /**
   * Which way the picks in this round actually ran, read off the picks themselves — never
   * re-derived from a serpentine rule, which belongs to the engine. Null until the round has
   * two picks to compare (and always, for an auction, where a "round" is not an order).
   */
  readonly direction: "forward" | "reverse" | null;
  readonly cells: readonly BoardCell[];
}

/**
 * Sticker lettering, at two sizes. The board auto-fits its columns to whatever width the stage
 * gives it, so the type grows with them — comfortable above `xl`, compact below. A breakpoint
 * rather than a container query on purpose: the stage IS the viewport minus one fixed-width
 * rail, so viewport width and column width move together, and a breakpoint is the mechanism
 * the rest of this codebase (and its happy-dom tests) already reasons about.
 */
const CELL_TEXT: Readonly<Record<DraftBoardVariant, string>> = {
  room: "text-md",
  tv: "text-display-md",
};

/**
 * The sticker minimum: the narrowest a column may get before the board stops shrinking and
 * starts scrolling sideways inside its own container. Above it, `w-full` on an auto-layout
 * table spreads the surplus evenly across the columns — which is what "maximize the width"
 * actually means for a board whose column count is the league's, not ours.
 */
/**
 * E4 (2026-08-26 design review): at 1440px with chat open, the room variant's stickers
 * (`min-w-32`/`xl:min-w-40`) left only ~4.3 of 12 columns on screen — the on-clock cell and
 * the manager's own column were routinely off-viewport. `min-w-28` is a denser floor for the
 * belt BELOW `lg` (a laptop that is not yet desktop-wide); `lg:min-w-32` and `xl:min-w-40`
 * are the same two sizes this board already had right at wider widths — untouched.
 */
/** WIDTHS, not min-widths (laptop fit, 2026-08-26): `table-fixed` sizes columns from the
 *  header row's `width` and ignores `min-width` entirely — the min-w floors this constant
 *  used to carry silently stopped existing the moment the table went fixed, collapsing twelve
 *  columns into avatar-only slivers. ONE desktop width (128px) from lg up — measured at
 *  1280x800, w-36 columns left the fourth column four pixels off-screen; at 128px a laptop
 *  reads four-plus columns and a 2000px desktop reads ten. */
const CELL_MIN_WIDTH: Readonly<Record<DraftBoardVariant, string>> = {
  room: "w-28 lg:w-32",
  tv: "w-48",
};

/**
 * Task 12 Step 3: the TV board never drops to `xs` — every place this board would otherwise use
 * `text-xs` (a sticker's position/team sub-line, the draft-slot number, the "You" mark, the
 * `Rd` column header, the on-clock/pending cell labels) steps up one notch on the TV variant.
 * `META_TEXT` covers the plain size bump; `HEADER_EYEBROW` covers the two places that were
 * `EYEBROW` outright — the same "TV steps its own eyebrows up, never reaches into shared chrome"
 * scope `RoomRail`'s own `RAIL_EYEBROW` docblock states.
 */
const META_TEXT: Readonly<Record<DraftBoardVariant, string>> = {
  room: "text-xs",
  tv: "text-sm",
};

const HEADER_EYEBROW: Readonly<Record<DraftBoardVariant, string>> = {
  room: EYEBROW,
  tv: "font-display text-sm font-semibold tracking-wide",
};

/** The column order: the draft order once it exists, the league's teams before it does. */
function columnIdsOf(view: DraftStateView, teams: readonly TeamCard[]): readonly string[] {
  return view.draftOrder.length > 0 ? view.draftOrder : teams.map((team) => team.id);
}

function pickKey(teamId: string, round: number): string {
  return `${teamId}:${round}`;
}

/**
 * The round each team is about to fill: how many picks they already own, plus one. Derived
 * from the board itself rather than from the pick number, so no turn-order rule is restated
 * here — a team's next row is simply the first empty one.
 */
function nextRoundByTeam(view: DraftStateView): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const pick of view.picks) counts.set(pick.teamId, (counts.get(pick.teamId) ?? 0) + 1);
  return new Map([...counts].map(([teamId, count]) => [teamId, count + 1]));
}

/**
 * teamId -> the ROUNDS a skip left open for them (Task 5). `owedPicks` names pick NUMBERS —
 * the engine's own global counter, not a round — so this is the one place the board converts
 * between the two.
 *
 * `Math.ceil(pickNumber / teamCount)`, byte-identical to `roundForPick` (`@/draft-engine`,
 * `order.ts`) — not imported, because client room code may only import TYPES from
 * `@/draft-engine` (the HTTP/SSE boundary rule this whole directory is held to; see this
 * repo's own `no-restricted-imports` config). A round number is arithmetic on a value the wire
 * already sent (`pickNumber`), not a turn-order RULE re-derived here — the same distinction
 * `directionOf` below draws for a round's serpentine direction.
 */
function pendingRoundsByTeam(view: DraftStateView): ReadonlyMap<string, ReadonlySet<number>> {
  const teamCount = view.draftOrder.length;
  const roundForPick = (pickNumber: number): number => Math.ceil(pickNumber / teamCount);
  return new Map(
    Object.entries(view.owedPicks ?? {}).map(([teamId, pickNumbers]) => [teamId, new Set(pickNumbers.map(roundForPick))]),
  );
}

function directionOf(picks: readonly CompletedPick[], columnIds: readonly string[]): "forward" | "reverse" | null {
  if (picks.length < 2) return null;
  const first = picks.reduce((min, pick) => (pick.pickNumber < min.pickNumber ? pick : min));
  const last = picks.reduce((max, pick) => (pick.pickNumber > max.pickNumber ? pick : max));
  return columnIds.indexOf(first.teamId) < columnIds.indexOf(last.teamId) ? "forward" : "reverse";
}

interface BuiltBoard {
  readonly rows: readonly BoardRow[];
  /** Which round the board is actively filling — the same derivation `RoomRail`'s own
   *  `currentRound` makes, exposed here too since E7's TV compression cuts off relative to it
   *  (`activeRound + DRAFT_ROOM_CONFIG.tv.futureRoundsShown`), not the `future` flag above
   *  (which recedes by SHAPE one round earlier, for the room's own sliver treatment). */
  readonly activeRound: number;
}

function buildRows(view: DraftStateView, columnIds: readonly string[]): BuiltBoard {
  // The last round with any action; empties beyond the next round fade to quiet the wall.

  const byCell = new Map(view.picks.map((pick) => [pickKey(pick.teamId, pick.round), pick]));
  const byRound = new Map<number, CompletedPick[]>();
  for (const pick of view.picks) byRound.set(pick.round, [...(byRound.get(pick.round) ?? []), pick]);

  const nextRound = nextRoundByTeam(view);
  const pendingRounds = pendingRoundsByTeam(view);
  const onClockTeamId = view.phase === "in_progress" ? view.onClockTeamId : null;
  const isSnake = view.format === "snake";
  const activeRound = Math.max(1, ...view.picks.map((pick) => pick.round), ...(onClockTeamId ? [nextRound.get(onClockTeamId) ?? 1] : []));

  const rows = Array.from({ length: rosterSpots(view.slotConfig) }, (_, index): BoardRow => {
    const round = index + 1;
    return {
      round,
      direction: isSnake ? directionOf(byRound.get(round) ?? [], columnIds) : null,
      cells: columnIds.map((teamId): BoardCell => ({
        teamId,
        pick: byCell.get(pickKey(teamId, round)) ?? null,
        onClock: teamId === onClockTeamId && (nextRound.get(teamId) ?? 1) === round,
        future: round > activeRound + 1,
        pending: pendingRounds.get(teamId)?.has(round) ?? false,
      })),
    };
  });

  return { rows, activeRound };
}

function StickerCell({
  leagueId,
  cell,
  playersById,
  variant,
  slap,
  spotlight,
  reasons,
  laws,
}: {
  readonly leagueId: string;
  readonly cell: BoardCell;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly variant: DraftBoardVariant;
  readonly slap: boolean;
  readonly spotlight: boolean;
  readonly reasons: ReadonlyMap<string, readonly BoardReason[]> | null;
  readonly laws: readonly Law[];
}) {
  if (cell.pick !== null) {
    const player = playersById.get(cell.pick.playerId) ?? null;
    // Task 8: strongest |effect| first, capped at two — law 4's "spend emphasis once" applied to
    // a sticker that already carries a name, a pick number, a position and a team. `null`
    // `reasons` (a caller that never threaded the pool's reason map) and an unranked player both
    // resolve to "no chips", exactly like every other reason surface's "absent means nothing to
    // say" rule.
    // ONE chip, compact (founder screenshot, 2026-09-04): two full-sentence chips in a fixed
    // sticker truncated to near-identical half-stats on every card. The strongest law's effect
    // is the fact worth a sticker's pixels; the full chain lives where there is room (the pool
    // row, the peek).
    const chips = strongestLawReasons(reasons?.get(cell.pick.playerId) ?? [], 1);
    const layout = `flex h-full items-center gap-2 px-2 py-2 ${slap ? "animate-sticker-slap" : ""}`;
    const body = (
      <>
        {/* The real face, initials fallback (founder directive 2026-08-26) — but only from xl
            up: on a laptop the avatar widened every sticker ~40px and cost the room two whole
            columns (founder question, 2026-08-26). Below xl the position color and the name
            carry the read, exactly as they did before faces existed; the face rejoins where
            the width is free. `hidden xl:flex` keeps it in the DOM for the row's height math
            nowhere — display none costs nothing. */}
        <Avatar name={player?.name ?? cell.pick.playerId} avatar={player?.headshotUrl ?? null} size="sm" className="hidden shrink-0 bg-scrim/20 xl:flex" />
        <div className="flex min-w-0 flex-col justify-center gap-0.5">
          {/* Task 3 (player-name adoption sweep): the room variant's sticker is otherwise
              non-interactive, so the name becomes the ONE control in it — the TV variant keeps
              every control inert (standing law: "no control on it is ever clickable"), and a
              player metadata gap (`player === null`) keeps the raw id as inert text either way,
              since `PlayerName` needs a real name to show. */}
          {variant === "room" && player !== null ? (
            <PlayerName
              leagueId={leagueId}
              playerId={cell.pick.playerId}
              name={player.name}
              className={`truncate font-display font-semibold leading-display ${CELL_TEXT[variant]}`}
            />
          ) : (
            <span className={`truncate font-display font-semibold leading-display ${CELL_TEXT[variant]}`}>
              {player?.name ?? cell.pick.playerId}
            </span>
          )}
          {/* Law 4, on a cell that got taller once the round horizon reclaimed the stage: the
              pick's own NUMBER leads the meta line. It is the fact a manager asks about a
              sticker he is looking at ("when did that go?"), it is already on the payload, and
              it costs three characters of a line that was carrying two facts in a cell with room
              for three. Mono, because it is a figure in a run of labels. */}
          <span className={`truncate font-medium ${META_TEXT[variant]}`}>
            <span className="font-mono tabular-nums">{`#${cell.pick.pickNumber}`}</span>
            {` · ${player?.position ?? cell.pick.slot} · ${player?.nflTeam ?? cell.pick.slot}`}
            {cell.pick.price === null ? "" : ` · $${cell.pick.price}`}
          </span>
          {chips.length === 0 ? null : (
            <div className="flex flex-col gap-0.5">
              {chips.map((reason) => (
                <ReasonChip key={reason.lawId} reason={reason} registry={laws} compact />
              ))}
            </div>
          )}
        </div>
      </>
    );
    // A pick whose player metadata hasn't loaded yet is the one sticker with no pigment.
    return player === null ? (
      <div className={`rounded-sm border border-line bg-surface-elevated text-text-primary shadow-sticker ${layout}`}>{body}</div>
    ) : (
      <Sticker position={player.position} className={layout}>
        {body}
      </Sticker>
    );
  }

  if (cell.onClock) {
    // THE LIVE CHANNEL (Sunday v5, law 4), not accent and no longer `negative` — E1
    // (2026-08-26) put this cell in the same red as the rail's hot clock, which was right about
    // the pairing and wrong about the family: through v4 one red meant both "happening now" and
    // "this went badly". v5 splits them, and a cell that is on the clock is the purest "right
    // now" this product draws. The one decision, made once: the "You" COLUMN marker in the
    // header stays amber — it names identity, never the clock.
    return (
      <div data-onclock-cell="true" className="relative flex h-full items-center justify-center rounded-sm border border-dashed border-line px-2 py-2">
        <span aria-hidden="true" className={`pointer-events-none absolute inset-0 rounded-sm ring-2 ring-live ${spotlight ? "animate-spotlight" : ""}`} />
        <span className={`${HEADER_EYEBROW[variant]} text-live`}>On the clock</span>
      </div>
    );
  }

  if (cell.pending) {
    // Task 5's own honesty: a skip leaves a genuine hole in an otherwise-filled round, and a
    // plain dashed cell reads identically to "not yet reached" — which it is not. Neutral voice,
    // no name (the room already knows whose turn it isn't, from the on-clock cell elsewhere):
    // the same "what happened, not who" restraint every skip notice keeps.
    return (
      <div data-pending-cell="true" className="flex h-full items-center justify-center rounded-sm border border-dashed border-line px-2 py-2">
        <span className={`${HEADER_EYEBROW[variant]} text-text-muted`}>Pending</span>
      </div>
    );
  }

  // Far-future rounds compress to slivers: the present deserves the space, and the shape of
  // the season is still visible without shouting. The recede is height only — see
  // `DRAFT_ROOM_CONFIG.emptyCellBorderClass`'s own docblock for why the border color never
  // dilutes further than `border-line`'s own decorative-hairline floor.
  const borderClass = cell.future ? DRAFT_ROOM_CONFIG.emptyCellBorderClass.future : DRAFT_ROOM_CONFIG.emptyCellBorderClass.near;
  return <div aria-hidden="true" className={`h-full rounded-sm border border-dashed ${borderClass}`} />;
}

/**
 * The draft board: teams across, rounds down, one colored sticker per pick. The hero of the
 * room — everything else on the page is support.
 *
 * Every value here comes off `view.picks` / `view.slotConfig` / `view.draftOrder` and the two
 * lookup maps. No rule is computed: the round a team is about to fill is "their first empty
 * row", and a round's serpentine direction is read off the pick numbers already in it rather
 * than from the alternation rule that produced them (which is the engine's, and stays there).
 */
export function DraftBoard({
  view,
  teams,
  playersById,
  myTeamId,
  landedPickNumber = null,
  variant = "room",
  mock = null,
  reasons = null,
  laws = [],
}: DraftBoardProps) {
  const reduced = usePrefersReducedMotion();
  const byId = teamsById(teams);
  const columnIds = columnIdsOf(view, teams);
  const { rows, activeRound } = buildRows(view, columnIds);
  const slapPickNumber = reduced ? null : landedPickNumber;

  // THE ROUND HORIZON, NOW ON BOTH VARIANTS (Gameday, law 4). E7 gave the TV a horizon in
  // 2026-08-26 and left the room without one; the first Gameday screenshot of the live room
  // showed why that was a mistake — at round 3 of 15, twelve of fifteen rows were empty dashed
  // rectangles and roughly 55% of the room's hero region carried no fact at all. Beyond the
  // horizon the season's shape is one honest line ("N rounds ahead"), which is the whole of what
  // an unreached round has to say. The room keeps a longer horizon than the TV because a manager
  // plans against the next few rounds; a party across a room only reads what is happening now.
  const cutoff = activeRound + DRAFT_ROOM_CONFIG.boardFutureRoundsShown[variant];
  const wideRows = rows.filter((row) => row.round <= cutoff);
  const collapsedRoundCount = rows.length - wideRows.length;

  const gridRef = useRef<HTMLDivElement | null>(null);
  const onClockKey = view.phase === "in_progress" ? `${view.onClockTeamId ?? ""}:${view.pickNumber}` : "";
  useEffect(() => {
    // The current pick is the most important cell in the product: keep it in view. happy-dom
    // implements scrollIntoView as a no-op, so tests exercise presence, not scrolling.
    const cell = gridRef.current?.querySelector('[data-onclock-cell="true"]');
    cell?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [onClockKey]);

  const cellFor = (cell: BoardCell) => (
    <StickerCell
      leagueId={view.leagueId}
      cell={cell}
      playersById={playersById}
      variant={variant}
      slap={cell.pick !== null && cell.pick.pickNumber === slapPickNumber}
      spotlight={!reduced}
      reasons={reasons}
      laws={laws}
    />
  );

  // Rounds worth showing on a phone: the ones that have happened, plus the one in progress,
  // newest first. A board of empty rounds is a scroll, not information.
  const listRows = [...rows]
    .reverse()
    .filter((row) => row.cells.some((cell) => cell.pick !== null || cell.onClock || cell.pending));

  return (
    <section aria-label="Draft board" className="flex h-full min-h-0 flex-col gap-3">
      {/* Wide: the board itself, scrolling inside its own container so the page never does.
          The grid's own native scrollbar is the scroll affordance — the same convention
          `Table` already uses for its own horizontal overflow. A prior version painted a
          decorative edge-fade here unconditionally (whether or not the grid actually had
          anything left to scroll to), which read as shading smeared across the last visible
          column's own sticker colors — founder live defect #2. Removed outright rather than
          made conditional on real scroll position: a box painted over a sticker's own color
          is exactly what rule 4 (hairlines, not boxes) rules out. */}
      <div className="relative hidden min-h-0 w-full flex-1 sm:block">
        {/* Column snap: a scrolled board always rests on whole stickers, never slivers. */}
        <div ref={gridRef} data-testid="draft-board-grid" className="h-full w-full overflow-auto">
        {/* `table-fixed` (laptop fit, 2026-08-26): under auto layout the LONGEST player name
            set every column's width — the min-w floors and every truncate on the stickers were
            decorative, and a 1280px laptop saw one full column. Fixed layout makes the header
            row's widths the law: each team column takes its min-w floor (stretching evenly
            when the stage is wider than 12 floors), names truncate as always intended, and the
            Rd column keeps its own narrow width below. */}
        {/* `h-full` (Gameday, law 4): with the horizon above collapsing the unreached rounds,
            the board no longer has fifteen rows to spend the stage on, and a short table left a
            void under it that says even less than the dashed cells did. Filling the stage hands
            the reclaimed pixels back to the ROWS — the same picks, drawn larger — so the board
            reads as a scoreboard rather than a spreadsheet. Rows still grow past the stage on a
            deep board, and the container above is the scroller, exactly as before.

            ONLY ONCE THERE IS A PICK TO DRAW, though. Before kickoff every cell is empty by
            construction, and stretching three empty rounds across the whole stage inflates 175px
            dashed rectangles — the exact defect the horizon was added to fix, arrived at from the
            other direction. A board with nothing on it takes its natural height and lets the
            waiting room breathe. */}
        <table className={`w-full table-fixed border-separate border-spacing-1 text-left ${view.picks.length === 0 ? "" : "h-full"}`}>
          <caption className="sr-only">The draft board: one row per round, one column per team.</caption>
          {/* The whole header row is STICKY-TOP (founder screenshot, 2026-08-26): deep in a
              draft the auto-scroll follows the current pick down the grid, and a static header
              row slid up under the wire band — the room lost its column names exactly when a
              reader needs them most. The corner cell pins BOTH axes (it already pinned left for
              the horizontal scroll); every header cell carries the surface fill so stickers
              pass beneath, never through. */}
          <thead>
            <tr>
              <th scope="col" className={`w-12 sticky left-0 top-0 z-30 bg-surface px-2 py-1 text-text-muted ${HEADER_EYEBROW[variant]}`}>
                Rd
              </th>
              {columnIds.map((teamId, index) => (
                <th
                  key={teamId}
                  scope="col"
                  className={
                    `${CELL_MIN_WIDTH[variant]} sticky top-0 z-20 bg-surface snap-start scroll-ml-10 truncate rounded-sm px-2 py-1 font-display font-semibold leading-display ` +
                    (teamId === myTeamId ? "ring-2 ring-accent text-accent" : "text-text-primary")
                  }
                >
                  {/* The columns ARE the draft order; the slot number says so out loud. */}
                  <span aria-hidden="true" className={`mr-1.5 font-mono tabular-nums text-text-muted ${META_TEXT[variant]}`}>{index + 1}</span>
                  <span className="sr-only">{`Draft slot ${index + 1}: `}</span>
                  {teamName(byId, teamId)}
                  {mock === null || byId.get(teamId)?.isBot !== true ? null : (
                    // Rule 1: ink, not color — `Badge`'s `neutral` tone is a hairline border and
                    // muted text, the same quiet chip every other neutral label in this room
                    // already wears. The visible text is `mock.botBadge` ("Bot"); the fuller,
                    // never-claims-intelligence label rides alongside it for assistive tech only
                    // (`MOCK_COPY.botMarkerLabel`'s own docblock — never "AI opponent").
                    <Badge tone="neutral" className="ml-1.5 align-middle">
                      {mock.botBadge}
                      <span className="sr-only"> ({mock.botMarkerLabel})</span>
                    </Badge>
                  )}
                  {teamId === myTeamId ? (
                    <span className={`ml-2 font-display tracking-wide text-accent ${META_TEXT[variant]}`}>You</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {wideRows.map((row) => (
              <tr key={row.round}>
                <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-1 align-middle font-display font-semibold text-text-muted">
                  <span className="flex items-center gap-1">
                    {row.round}
                    {row.direction === null ? null : (
                      <span aria-hidden="true" className="text-text-muted">
                        {row.direction === "forward" ? "→" : "←"}
                      </span>
                    )}
                  </span>
                  {row.direction === null ? null : (
                    <span className="sr-only">{row.direction === "forward" ? ", picked left to right" : ", picked right to left"}</span>
                  )}
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.teamId} className="align-top">
                    {cellFor(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {collapsedRoundCount <= 0 ? null : (
            // E7: the season's shape past the TV's own reading distance is a number, not 140
            // empty cells — one hairline-topped, mono, muted line rather than the void the
            // review flagged.
            <tfoot>
              <tr>
                <td colSpan={columnIds.length + 1} className="border-t border-line px-2 py-1 font-mono text-sm text-text-muted">
                  {/* The cell spans the board's whole scroll width, and the board auto-scrolls
                      to the current pick — without the sticky pin (the Rd column's own idiom,
                      above) this label sat thousands of px off-viewport and a TV across the
                      room saw only a bare hairline (closing visual pass). */}
                  <span className="sticky left-2 inline-block">{`${plural(collapsedRoundCount, "round")} ahead`}</span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
        </div>
      </div>

      {/* Narrow: the same board as a round-by-round list, newest round first. */}
      <ol data-testid="draft-board-list" className="flex flex-col gap-4 sm:hidden">
        {listRows.map((row) => (
          <li key={row.round} className="flex flex-col gap-2">
            {/* `h2`, not `h3`: the rail's league name is the page's only `h1`, and a jump to
                `h3` is a real heading-order violation (axe catches it). */}
            <h2 className="font-display text-display-sm font-semibold leading-display text-text-primary">Round {row.round}</h2>
            <ul className="flex flex-col gap-2">
              {row.cells
                .filter((cell) => cell.pick !== null || cell.onClock || cell.pending)
                .map((cell) => (
                  <li key={cell.teamId} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate font-display font-semibold text-text-muted">{teamName(byId, cell.teamId)}</span>
                    {/* `min-w-0` beside `grow`: a flex item's automatic minimum size is its
                        content, so a sticker's own face plus a long name stretched this list past
                        a 360px viewport and scrolled the whole PAGE sideways. The sticker's own
                        inner column already truncates; this is what lets it. */}
                    <span className="min-w-0 grow">{cellFor(cell)}</span>
                  </li>
                ))}
            </ul>
          </li>
        ))}
        {listRows.length === 0 ? (
          <li className="rounded-sm border border-dashed border-line p-4 text-sm text-text-muted">
            Nothing drafted yet.
          </li>
        ) : null}
      </ol>
    </section>
  );
}
