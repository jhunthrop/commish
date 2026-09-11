"use client";

import { Fragment, useMemo, useState } from "react";
import type { Player, Position } from "@/domain/player";
import { auctionValues, type AuctionShape } from "@/projections/auction/value";
import { quartilesFromSeasonBand } from "@/projections/preseason/band-quartiles";
import type { BoardReason } from "@/projections/preseason/board";
import { BigNumber, BottomSheet, Card, Input, NOT_STARTED_DASH, PlayerFace, PlayerRow, ReasonChip, RosterStatusPill, SegmentGroup, TierDivider } from "@/components/ui";
import { NOT_ON_ACTIVE_ROSTER_BAND, NOT_ON_ACTIVE_ROSTER_NOTE } from "@/projections/preseason/roster-status-copy";
import { MICRO_LABEL } from "@/components/ui/config";
import type { Law } from "@/projections/laws/types";
import { groupReasons } from "@/league-room/outlook/groups";
import { marketOrderNoteFor } from "@/draft-room/lib/market-order-note";
import { strongestEvidenceSentence, tierBandLabel, tierNumber, vsMarketLabel } from "./copy";
import { BOARD_LAST_SEASON, type BoardRow } from "./service";

const POSITION_TABS: readonly { readonly value: string; readonly label: string }[] = [
  { value: "ALL", label: "Overall" },
  { value: "QB", label: "QB" },
  { value: "RB", label: "RB" },
  { value: "WR", label: "WR" },
  { value: "TE", label: "TE" },
  { value: "K", label: "K" },
  { value: "DEF", label: "DEF" },
];

/** The comma-separated header row a CSV export prints — one column per field
 *  `rowToCsv` below writes, in the same order. "Strongest law" retired (board persona fix 3):
 *  the strongest-evidence sentence now lives in the why drawer's top line, not a column that was
 *  mostly blank and, when it did fire, a bare "+1.3 pts" figure nobody could place. */
const CSV_HEADER = [
  "Rank",
  "Name",
  "Position",
  "Team",
  "Bye",
  // Which scoring the projection is under (the scoring-formats round): a file read away from
  // this screen is exactly where "Projected pts" would otherwise lose its basis.
  "Scoring",
  "Projected pts",
  "Floor",
  "Ceiling",
  "ADP",
  "Vs ADP (picks)",
  "Auction value",
  // The four LAST SEASON columns (the 2026-09-06 kicker and team defense round). Their own
  // columns and never folded into "Projected pts": a measured season and a projected one are
  // different claims, and a file read away from this screen is exactly where that difference
  // would be lost. Blank on every row that has no measured season.
  "Last season",
  "Last season pts",
  "Last season games",
  "Last season per game",
];

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The whole export, as data: header plus one line per row, auction values computed HERE from
 * the rows themselves — never threaded from view state, so no on-screen toggle can blank a
 * column of a downloaded file (re-review round 2's regression, pinned by board-csv.test.ts).
 */
export function boardCsvLines(orderedRows: readonly BoardRow[], auctionShape: AuctionShape, scoringLabel: string): readonly string[] {
  // The "Not on an active roster" band stays out of the file: a row with no number in any column
  // but a name is a row the reader of a spreadsheet will rank by accident. The screen keeps them,
  // with their status beside them, which the file has no column for.
  const ranked = orderedRows.filter((row) => row.rosterStatus?.excluded !== true);
  const values = auctionValues(ranked.map((row) => ({ playerId: row.playerId, valueOverReplacement: row.valueOverReplacement })), auctionShape);
  return [CSV_HEADER.map(csvField).join(","), ...ranked.map((row) => rowToCsv(row, values.get(row.playerId) ?? null, scoringLabel))];
}

/** One number for the file, or an EMPTY CELL when the engine has none (the 2026-09-05 kicker and
 *  team defence round). Never `0.0`: a downloaded file is read away from every explanation this
 *  surface carries, so a fabricated zero in it is the version that survives. */
function csvNumber(value: number | null, digits = 1): string {
  return value === null ? "" : value.toFixed(digits);
}

function rowToCsv(row: BoardRow, dollarValue: number | null, scoringLabel: string): string {
  // A market-order row is ordered BY the market, so an edge against the market would be the
  // ordering compared with itself. Blank, like every other cell the engine has no opinion behind.
  const edge = row.marketAdp === null || row.overallRank === null ? "" : (row.marketAdp - row.overallRank).toFixed(1);
  return [
    row.overallRank === null ? "" : String(row.overallRank),
    row.name,
    row.position,
    row.team,
    row.byeWeek === null ? "" : String(row.byeWeek),
    scoringLabel,
    csvNumber(row.projectedPoints),
    csvNumber(row.floorPoints),
    csvNumber(row.ceilingPoints),
    csvNumber(row.marketAdp),
    edge,
    dollarValue === null ? "" : `$${dollarValue}`,
    row.lastSeason === null ? "" : String(row.lastSeason.season),
    csvNumber(row.lastSeason?.points ?? null),
    row.lastSeason === null ? "" : String(row.lastSeason.games),
    csvNumber(row.lastSeason?.pointsPerGame ?? null),
  ]
    .map(csvField)
    .join(",");
}

/** `lines` is the COMPLETE file, header included — `boardCsvLines` owns the content, this owns
 *  only the browser download mechanics. */
function downloadCsv(filename: string, lines: readonly string[]): void {
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function toPlayer(row: BoardRow): Player {
  return { id: row.playerId, name: row.name, position: row.position, nflTeam: row.team, headshotUrl: row.headshotUrl, adp: row.marketAdp };
}

interface EvidenceDrawerState {
  readonly row: BoardRow;
}

/**
 * WHAT THE DRAWER SAYS ABOUT A ROW THE ENGINE NEVER RANKED (the 2026-09-06 round).
 *
 * It used to say "No laws fired for this player. His number comes from the base model alone." on a
 * row that has no number and no base model behind it — false twice over, and the exact sentence a
 * manager would read as a broken screen. A market-order row instead gets the same sentence the tab
 * above it carries (`marketOrderNoteFor`, one phrasing product-wide) followed by what he measurably
 * did last season, if the archive holds it.
 */
function MarketOrderBody({ row }: { readonly row: BoardRow }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-muted">{marketOrderNoteFor(row.position)}</p>
      <p className="text-sm text-text-primary">{lastSeasonSentence(row)}</p>
    </div>
  );
}

/**
 * The measured season in one sentence, with the year and the basis named. Never a bare number.
 *
 * THE ABSENCE SENTENCE NAMES THE YEAR TOO, and that is not pedantry: a veteran who missed last
 * season entirely has a real career and no 2025 in it, and "we hold no season for him" would be a
 * claim about his whole record rather than about the one year this column reports.
 */
function lastSeasonSentence(row: BoardRow): string {
  const last = row.lastSeason;
  // A team defense is a club, not a "he".
  const subject = row.position === "DEF" ? "this defense" : "he";
  if (last === null) {
    return `${row.position === "DEF" ? "This defense" : "He"} has no ${BOARD_LAST_SEASON} season on record, so there is nothing here to measure.`;
  }
  return `In ${last.season} ${subject} scored ${last.points.toFixed(1)} points over ${last.games} games, ${last.pointsPerGame.toFixed(1)} a game, under this league's scoring.`;
}

/**
 * HIS RANGE, IN THE DRAWER (Sideline research round) — the "most seasons" band and its tails used
 * to be a column of their own on a seven-column table. P2 allows a row ONE number larger than body
 * text, and P10 caps a comparison list at four regions, so the band moved one press away rather
 * than being dropped: it is the second thing a veteran asks after the projection, and the drawer is
 * where the board already answers "why".
 *
 * The convention is the founder's own (2026-09-04): the p25-p75 band leads as "most seasons", the
 * honest p10-p90 rides behind it as the tails. A row with no projection has no band and says so by
 * rendering nothing at all.
 */
function RangeSentence({ row }: { readonly row: BoardRow }) {
  if (row.medianPoints === null || row.floorPoints === null || row.ceilingPoints === null) return null;
  const { p25, p75 } = quartilesFromSeasonBand(row.medianPoints, row.floorPoints, row.ceilingPoints);
  return (
    <p className="text-sm text-text-muted">
      {`Most seasons land between ${p25.toFixed(0)} and ${p75.toFixed(0)} points. The full range, injury seasons and smash seasons included, runs ${row.floorPoints.toFixed(0)} to ${row.ceilingPoints.toFixed(0)}.`}
    </p>
  );
}

function EvidenceDrawer({ state, laws, onClose }: { readonly state: EvidenceDrawerState; readonly laws: readonly Law[]; readonly onClose: () => void }) {
  // Fix 3 (board persona review, 2026-09-04): the retired "Strongest law" column's own sentence
  // opens the drawer instead, built from the SAME grouped-outlook machinery the Outlook already
  // renders (`groupReasons`/`lawGroupLabel`) — one voice product-wide, never a second phrasing.
  const groups = groupReasons(state.row.reasons, laws);
  const strongest = strongestEvidenceSentence(groups);
  const isMarketOrder = state.row.marketOrderRank !== null;

  return (
    <BottomSheet label={`Why ${state.row.name} ranks here`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <PlayerFace player={toPlayer(state.row)} size="lg" />
          <div className="flex flex-col">
            <span className="font-display text-xl font-semibold leading-display text-text-primary">{state.row.name}</span>
            <span className="text-sm text-text-muted">
              {/* A market-order row has no overall rank at all, so it names the only ordering it
                  has rather than printing "rank" with nothing after it. */}
              {state.row.team} · bye {state.row.byeWeek ?? "?"} ·{" "}
              {state.row.marketOrderRank === null ? `rank ${state.row.overallRank}` : `${state.row.position}${state.row.marketOrderRank} by draft order`}
            </span>
          </div>
        </div>
        {strongest === null ? null : <p className="text-base font-medium text-text-primary">{strongest}</p>}
        <RangeSentence row={state.row} />
        {isMarketOrder ? (
          <MarketOrderBody row={state.row} />
        ) : state.row.reasons.length === 0 ? (
          <p className="text-sm text-text-muted">No laws fired for this player. His number comes from the base model alone.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.row.reasons.map((reason: BoardReason, index) => (
              <li key={`${reason.code}-${index}`}>
                <ReasonChip reason={reason} registry={laws} className="w-full" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}

/**
 * THE ONE NUMBER THIS ROW GETS, AND WHAT IT IS (P2, P11) — a `BigNumber`'s value and its basis
 * caption, decided once here so the row, the CSV and the drawer can never disagree about which
 * claim the figure is making.
 *
 * THREE DIFFERENT CLAIMS, never blended and never sharing a caption:
 * - the **auction value**, while the $ board is on: a dollar figure under a stated league shape;
 * - what he **measurably scored last season**, on the tabs the engine publishes no projection for
 *   (a kicker, a team defense — `KDEF_DECISION`), with the games it was scored over in the caption
 *   because a total without its denominator invites a seventeen-game season to be read beside a
 *   nine-game one;
 * - his **projected season total** everywhere else, under the scoring the selector names.
 *
 * A `null` value prints a dash and the caption says why (never a zero, never a borrowed number).
 *
 * EVERY CAPTION IS ONE LINE AT THE ROW FIGURE'S OWN WIDTH, and that is a measured constraint, not a
 * preference: `BigNumber size="sm"` caps its caption at 6.5rem, a second line costs 13px, and a
 * 44px research row (`TOKENS.density.denseRowPx`) has none to give. So the caption names the RULES
 * ("Projected, PPR") and the span rides the screen around it — the scoring selector is two inches
 * above the list and the basis card beside it names the board's season. The one number a caption
 * cannot carry alone is a season total's denominator, which is why the games count moved onto the
 * facts line: a total without the games it was scored over invites a seventeen-game season to be
 * compared with a nine-game one.
 */
function figureFor(
  row: BoardRow,
  options: { readonly dollarView: boolean; readonly dollarValue: number | null; readonly showLastSeason: boolean; readonly scoringLabel: string },
): { readonly value: string | null; readonly basis: string } {
  if (options.dollarView) {
    return options.dollarValue === null
      ? { value: null, basis: "No rank to value" }
      : { value: `$${options.dollarValue}`, basis: "Auction value" };
  }
  if (options.showLastSeason) {
    const last = row.lastSeason;
    return last === null ? { value: null, basis: `No ${BOARD_LAST_SEASON} season` } : { value: last.points.toFixed(1), basis: `Scored, ${last.season}` };
  }
  return row.projectedPoints === null
    ? { value: null, basis: row.rosterStatus?.excluded === true ? "Off a roster" : "No projection" }
    : { value: row.projectedPoints.toFixed(1), basis: `Projected, ${options.scoringLabel}` };
}

/**
 * THE FACTS AFTER HIS NAME (P10: four regions, and this is one of them). The club and the bye
 * always; his rate last season on the tabs where last season IS the number; then his ADP and what
 * the drafting room is doing with it relative to our own rank, which is the one comparison on the
 * row and therefore the only thing on it with colour (P11).
 *
 * The reach case is NEVER red. Red implies a bad player and this number never meant that — see
 * `vsMarketLabel`'s own docblock, whose ruling this renders.
 */
function BoardMeta({ row, showLastSeason }: { readonly row: BoardRow; readonly showLastSeason: boolean }) {
  const edge = row.marketAdp === null || row.overallRank === null ? null : row.marketAdp - row.overallRank;
  const vsMarket = vsMarketLabel(edge);
  const last = row.lastSeason;
  return (
    <>
      {row.team}
      {row.byeWeek === null ? "" : ` · bye ${row.byeWeek}`}
      {showLastSeason && last !== null ? ` · ${last.games} games, ${last.pointsPerGame.toFixed(1)} a game last season` : ""}
      {row.marketAdp === null ? "" : ` · ADP ${row.marketAdp.toFixed(1)}`}
      {vsMarket === null ? null : (
        <>
          {" · "}
          <span className={vsMarket.tone === "positive" ? "font-semibold text-positive" : undefined}>{vsMarket.text}</span>
        </>
      )}
    </>
  );
}

export interface BoardViewProps {
  readonly rows: readonly BoardRow[];
  readonly laws: readonly Law[];
  /** Always available — the generic default carries a 12-team standard shape too, so the $
   *  toggle works with or without a real league selected. */
  readonly auctionShape: { readonly teamCount: number; readonly rosterSpots: number; readonly budget: number };
  readonly exportFilename: string;
  /** "PPR", "Half PPR" or "Standard": the scoring every projected number on these rows is under,
   *  named in the export's own column (the scoring-formats round). */
  readonly scoringLabel: string;
}

/**
 * THE BOARD'S CLIENT HALF (spec §3) — position tabs, search, the rookie filter, the auction $
 * toggle and the evidence drawer are all client state over the ALREADY-COMPUTED rows the server
 * component fetched (league selection itself is a server re-render, via a plain link to
 * `?league=`, since that is what changes the recomputed value/tier numbers). CSV export reads the
 * exact rows on screen.
 */
export function BoardView({ rows, laws, auctionShape, exportFilename, scoringLabel }: BoardViewProps) {
  const [position, setPosition] = useState("ALL");
  const [search, setSearch] = useState("");
  const [rookiesOnly, setRookiesOnly] = useState(false);
  const [dollarView, setDollarView] = useState(false);
  const [drawer, setDrawer] = useState<EvidenceDrawerState | null>(null);

  // Fix round 1, LOW: gated on `dollarView` — every row's auction value is a real computation
  // (`auctionValues` sorts and ranks the whole board), and there is no reason to pay for it on
  // every render of a board most managers view in points, never dollars.
  const dollarValues = useMemo(
    () => (dollarView ? auctionValues(rows.map((row) => ({ playerId: row.playerId, valueOverReplacement: row.valueOverReplacement })), auctionShape) : new Map<string, number>()),
    [dollarView, rows, auctionShape],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (position !== "ALL" && row.position !== position) return false;
      if (rookiesOnly && !row.reasons.some((reason) => reason.code === "rookie")) return false;
      if (term !== "" && !row.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, position, rookiesOnly, search]);

  const ordered = useMemo(() => {
    if (!dollarView) return filtered;
    return [...filtered].sort((a, b) => (dollarValues.get(b.playerId) ?? 1) - (dollarValues.get(a.playerId) ?? 1));
  }, [filtered, dollarView, dollarValues]);

  // THE BAND (the roster-status gate, 2026-09-08): the players the gate took off the board render
  // LAST, under their own heading, whatever the sort — they hold no rank, no tier and no dollar
  // value, so no ordering above can place them. `ranked` is everything else, and is what the CSV
  // exports (`boardCsvLines` keeps the same split).
  const notOnRoster = useMemo(() => ordered.filter((row) => row.rosterStatus?.excluded === true), [ordered]);
  const displayed = useMemo(() => [...ordered.filter((row) => row.rosterStatus?.excluded !== true), ...notOnRoster], [ordered, notOnRoster]);

  // Tier bands are computed PER POSITION by the engine (`board.ts`'s own docblock) — a mixed
  // "Overall" list has no single cross-position tier ladder to draw, so a band only renders when
  // exactly one position is selected and the list is in its natural (non-dollar) rank order.
  const showTiers = position !== "ALL" && !dollarView;

  // Only while a single position is selected: the note is about THAT position, and printing it over
  // the mixed "Overall" list would attach a claim to rows it is not about.
  const marketOrderNote = position === "ALL" ? null : marketOrderNoteFor(position as Position);
  // The same condition, named for what it does to the TABLE rather than to the note above it: on a
  // market-order tab every row is a market-order row, so the two projection columns can carry last
  // season instead. Never on "Overall", where projected and market-order rows sit in one list and a
  // column that meant two things depending on the row would be unreadable.
  const showLastSeason = marketOrderNote !== null;

  let lastTier: number | null = null;

  return (
    <div className="flex flex-col gap-4">
      {/* THE FILTER BAR, ONE LINE THAT SCROLLS (Sideline research round, from a measured phone
          walk). These five controls used to wrap to three rows at 360px and push every player row
          off the screen, on the one surface whose job (P10) is fitting at least eight objects on a
          phone. The bar keeps its row and scrolls sideways instead; the search field shrinks with
          it, because a name is the thing a reader types when he already knows who he is looking
          for and the position tabs are what he sweeps. */}
      <div className="flex items-end gap-3 overflow-x-auto pb-1">
        <div className="shrink-0">
          <SegmentGroup label="Position" options={POSITION_TABS} value={position} onChange={setPosition} labelled={false} />
        </div>
        <label className="flex h-10 shrink-0 items-center gap-1.5 text-sm whitespace-nowrap text-text-muted">
          <input type="checkbox" checked={rookiesOnly} onChange={(event) => setRookiesOnly(event.target.checked)} className="size-4 accent-accent" />
          Rookies only
        </label>
        <label className="flex h-10 shrink-0 items-center gap-1.5 text-sm whitespace-nowrap text-text-muted">
          <input type="checkbox" checked={dollarView} onChange={(event) => setDollarView(event.target.checked)} className="size-4 accent-accent" />
          $ board
        </label>
        <div className="w-44 shrink-0">
          <Input label="Search" placeholder="Search a name" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <button
          type="button"
          // The export always carries real auction values, whatever the on-screen toggle says
          // (re-review finding: a CSV column silently blanking on an unrelated view toggle is a
          // silent data drop). Computed at click time, so the render path still skips the pass.
          onClick={() => downloadCsv(exportFilename, boardCsvLines(ordered, auctionShape, scoringLabel))}
          className="h-10 shrink-0 rounded-md bg-surface-elevated px-3 text-sm font-medium whitespace-nowrap text-text-muted hover:text-text-primary sm:ml-auto"
        >
          Export CSV
        </button>
      </div>

      {/* A position the engine publishes no projection for says so, once, above its own table. The
          rows below it are real players in the market's own order with honestly blank projection
          cells, and without this sentence that reads as a bug rather than as a measurement that
          came back negative. `null` on every tab whose position carries a projection. */}
      {marketOrderNote === null ? null : (
        <p data-testid="board-market-order-note" className="rounded-sm bg-surface-inset px-3 py-2 text-xs text-text-muted">
          {marketOrderNote}
        </p>
      )}

      <Card as="section" aria-label="The evidence board" className="flex flex-col gap-0.5">
        {ordered.length === 0 ? <p className="px-2 py-6 text-center text-sm text-text-muted">No players match this filter.</p> : null}
        {displayed.map((row) => {
          // The band opens once, on its first row, in place of any tier divider: these rows carry
          // no tier, and the heading says what they are instead. Its own inset ground keeps it
          // visibly a different KIND of thing from a tier band (2026-09-08's own ruling, now with
          // a ground that makes it as obvious to the eye as it already was to the copy).
          const bandRow =
            notOnRoster[0] === row ? (
              <div key={`band-${row.playerId}`} data-testid="board-not-on-roster-band" className="mt-5 mb-1 rounded-lg bg-surface-inset px-4 py-3">
                <span className={`${MICRO_LABEL} block text-text-faint`}>{NOT_ON_ACTIVE_ROSTER_BAND}</span>
                <span className="block text-sm text-text-muted">{NOT_ON_ACTIVE_ROSTER_NOTE}</span>
              </div>
            ) : null;
          // TIERS ARE ONE-BASED (`tierNumber`): the plate carries the number, the label carries the
          // count and the drop, and neither says the other's half twice.
          const tierRow =
            bandRow === null && showTiers && row.rosterStatus?.excluded !== true && row.tier !== lastTier ? (
              <div key={`tier-${row.playerId}`} className="px-1 pt-3 pb-1">
                <TierDivider
                  grade={row.tier === 0 ? "S" : row.tier === 1 ? "A" : row.tier === 2 ? "B" : "C"}
                  letter={tierNumber(row.tier)}
                  label={tierBandLabel(position, row.playersLeftInTier ?? 0, row.dropToNextTier ?? 0)}
                />
              </div>
            ) : null;
          if (showTiers) lastTier = row.tier;
          const dollarValue = dollarValues.get(row.playerId) ?? null;
          const figure = figureFor(row, { dollarView, dollarValue, showLastSeason, scoringLabel });
          // Fix 1 (board persona review): on a position tab, positional rank leads and the overall
          // rank becomes the sub-fact. On "Overall" there is no single position context to lead
          // with, so the overall rank stays the lead. A market-order row leads with its place in
          // the drafting room's own order, which is the only ordering it has. A row off an active
          // roster holds no ordering at all and prints the dash it earns.
          const leadingRank =
            row.marketOrderRank ?? (position === "ALL" ? row.overallRank : (row.positionRankInValue ?? row.overallRank));
          return (
            <Fragment key={row.playerId}>
              {bandRow}
              {tierRow}
              {/* `board-row` is the TEST CONTRACT the table's `<tr>` used to be: a row is a `div`
                  now, so `closest("tr")` has nothing to find, and a test that walked DOM adjacency
                  instead would break on the next layout change rather than on a real one. */}
              <div data-testid="board-row" data-player={row.playerId}>
              <PlayerRow
                dense
                player={toPlayer(row)}
                lead={leadingRank ?? NOT_STARTED_DASH}
                positionRank={row.positionRankInValue ?? undefined}
                meta={<BoardMeta row={row} showLastSeason={showLastSeason} />}
                chips={row.rosterStatus === null ? null : <RosterStatusPill note={row.rosterStatus} />}
                figure={<BigNumber value={figure.value} basis={figure.basis} size="sm" />}
                action={
                  <button type="button" onClick={() => setDrawer({ row })} className="text-sm font-semibold text-accent hover:underline">
                    why
                  </button>
                }
              />
              </div>
            </Fragment>
          );
        })}
      </Card>

      {/* THE LEGEND IS GONE (P7: no explainer text — if a word needs explaining, change the word).
          It used to spend a paragraph naming what "Projected", "Most seasons" and "Why" meant,
          under a table whose headers said none of it. Every figure now carries its own basis in the
          caption under it ("Projected for the season, PPR"), the range moved into the drawer as a
          sentence, and a legend for columns that no longer exist would be explaining the furniture.
          The market-order note above survives because it is a MEASUREMENT that came back empty, not
          a description of the screen. */}
      {drawer === null ? null : <EvidenceDrawer state={drawer} laws={laws} onClose={() => setDrawer(null)} />}
    </div>
  );
}
