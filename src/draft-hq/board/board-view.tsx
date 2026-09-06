"use client";

import { Fragment, useMemo, useState } from "react";
import type { Player, Position } from "@/domain/player";
import { auctionValues, type AuctionShape } from "@/projections/auction/value";
import { quartilesFromSeasonBand } from "@/projections/preseason/band-quartiles";
import type { BoardReason } from "@/projections/preseason/board";
import { BottomSheet, Input, NOT_STARTED_DASH, PlayerFace, PositionBadge, ReasonChip, SegmentGroup, TierDivider } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { Law } from "@/projections/laws/types";
import { groupReasons } from "@/league-room/outlook/groups";
import { marketOrderNoteFor } from "@/draft-room/lib/market-order-note";
import { strongestEvidenceSentence, tierBandSentence, tierLetter, vsMarketLabel } from "./copy";
import type { BoardRow } from "./service";

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
const CSV_HEADER = ["Rank", "Name", "Position", "Team", "Bye", "Projected pts", "Floor", "Ceiling", "Market ADP", "Vs market (picks)", "Auction value"];

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The whole export, as data: header plus one line per row, auction values computed HERE from
 * the rows themselves — never threaded from view state, so no on-screen toggle can blank a
 * column of a downloaded file (re-review round 2's regression, pinned by board-csv.test.ts).
 */
export function boardCsvLines(orderedRows: readonly BoardRow[], auctionShape: AuctionShape): readonly string[] {
  const values = auctionValues(orderedRows.map((row) => ({ playerId: row.playerId, valueOverReplacement: row.valueOverReplacement })), auctionShape);
  return [CSV_HEADER.map(csvField).join(","), ...orderedRows.map((row) => rowToCsv(row, values.get(row.playerId) ?? null))];
}

/** One number for the file, or an EMPTY CELL when the engine has none (the 2026-09-05 kicker and
 *  team defence round). Never `0.0`: a downloaded file is read away from every explanation this
 *  surface carries, so a fabricated zero in it is the version that survives. */
function csvNumber(value: number | null, digits = 1): string {
  return value === null ? "" : value.toFixed(digits);
}

function rowToCsv(row: BoardRow, dollarValue: number | null): string {
  // A market-order row is ordered BY the market, so an edge against the market would be the
  // ordering compared with itself. Blank, like every other cell the engine has no opinion behind.
  const edge = row.marketAdp === null || row.overallRank === null ? "" : (row.marketAdp - row.overallRank).toFixed(1);
  return [
    row.overallRank === null ? "" : String(row.overallRank),
    row.name,
    row.position,
    row.team,
    row.byeWeek === null ? "" : String(row.byeWeek),
    csvNumber(row.projectedPoints),
    csvNumber(row.floorPoints),
    csvNumber(row.ceilingPoints),
    csvNumber(row.marketAdp),
    edge,
    dollarValue === null ? "" : `$${dollarValue}`,
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

function EvidenceDrawer({ state, laws, onClose }: { readonly state: EvidenceDrawerState; readonly laws: readonly Law[]; readonly onClose: () => void }) {
  // Fix 3 (board persona review, 2026-09-04): the retired "Strongest law" column's own sentence
  // opens the drawer instead, built from the SAME grouped-outlook machinery the Outlook already
  // renders (`groupReasons`/`lawGroupLabel`) — one voice product-wide, never a second phrasing.
  const groups = groupReasons(state.row.reasons, laws);
  const strongest = strongestEvidenceSentence(groups);

  return (
    <BottomSheet label={`Why ${state.row.name} ranks here`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <PlayerFace player={toPlayer(state.row)} size="lg" />
          <div className="flex flex-col">
            <span className="font-display text-xl font-semibold leading-display text-text-primary">{state.row.name}</span>
            <span className="text-sm text-text-muted">
              {state.row.team} · bye {state.row.byeWeek ?? "?"} · rank {state.row.overallRank}
            </span>
          </div>
        </div>
        {strongest === null ? null : <p className="text-base font-medium text-text-primary">{strongest}</p>}
        {state.row.reasons.length === 0 ? (
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

export interface BoardViewProps {
  readonly rows: readonly BoardRow[];
  readonly laws: readonly Law[];
  /** Always available — the generic default carries a 12-team standard shape too, so the $
   *  toggle works with or without a real league selected. */
  readonly auctionShape: { readonly teamCount: number; readonly rosterSpots: number; readonly budget: number };
  readonly exportFilename: string;
}

/**
 * THE BOARD'S CLIENT HALF (spec §3) — position tabs, search, the rookie filter, the auction $
 * toggle and the evidence drawer are all client state over the ALREADY-COMPUTED rows the server
 * component fetched (league selection itself is a server re-render, via a plain link to
 * `?league=`, since that is what changes the recomputed value/tier numbers). CSV export reads the
 * exact rows on screen.
 */
export function BoardView({ rows, laws, auctionShape, exportFilename }: BoardViewProps) {
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

  // Tier bands are computed PER POSITION by the engine (`board.ts`'s own docblock) — a mixed
  // "Overall" list has no single cross-position tier ladder to draw, so a band only renders when
  // exactly one position is selected and the list is in its natural (non-dollar) rank order.
  const showTiers = position !== "ALL" && !dollarView;

  // Only while a single position is selected: the note is about THAT position, and printing it over
  // the mixed "Overall" list would attach a claim to rows it is not about.
  const marketOrderNote = position === "ALL" ? null : marketOrderNoteFor(position as Position);

  let lastTier: number | null = null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentGroup label="Position" options={POSITION_TABS} value={position} onChange={setPosition} labelled={false} />
        <label className="flex items-center gap-1.5 text-sm text-text-muted">
          <input type="checkbox" checked={rookiesOnly} onChange={(event) => setRookiesOnly(event.target.checked)} className="size-4 accent-accent" />
          Rookies only
        </label>
        <label className="flex items-center gap-1.5 text-sm text-text-muted">
          <input type="checkbox" checked={dollarView} onChange={(event) => setDollarView(event.target.checked)} className="size-4 accent-accent" />
          $ board
        </label>
        <div className="w-48">
          <Input label="Search" placeholder="Search a name" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <button
          type="button"
          // The export always carries real auction values, whatever the on-screen toggle says
          // (re-review finding: a CSV column silently blanking on an unrelated view toggle is a
          // silent data drop). Computed at click time, so the render path still skips the pass.
          onClick={() => downloadCsv(exportFilename, boardCsvLines(ordered, auctionShape))}
          className="ml-auto rounded-md bg-surface-elevated px-3 py-2 text-sm font-medium text-text-muted hover:text-text-primary"
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

      <div className="w-full overflow-x-auto">
        <table className="w-full max-w-full border-collapse text-sm">
          <caption className="sr-only">The evidence board</caption>
          <thead>
            <tr className={`border-b border-line text-left ${MICRO_LABEL} text-text-faint`}>
              <th scope="col" className="px-2 py-2">
                Rank
              </th>
              <th scope="col" className="px-2 py-2">
                Player
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                Projected
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                Most seasons
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                Market ADP
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                Vs market
              </th>
              <th scope="col" className="px-2 py-2" />
              {dollarView ? (
                <th scope="col" className="px-2 py-2 text-right">
                  $
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {ordered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-6 text-center text-sm text-text-muted">
                  No players match this filter.
                </td>
              </tr>
            ) : null}
            {ordered.map((row) => {
              const tierRow =
                showTiers && row.tier !== lastTier ? (
                  <tr key={`tier-${row.playerId}`}>
                    <td colSpan={8} className="pt-3 pb-1">
                      <TierDivider
                        grade={row.tier === 0 ? "S" : row.tier === 1 ? "A" : row.tier === 2 ? "B" : "C"}
                        letter={tierLetter(row.tier)}
                        label={tierBandSentence(
                          tierLetter(row.tier),
                          position,
                          row.playersLeftInTier ?? 0,
                          row.dropToNextTier ?? 0,
                        )}
                      />
                    </td>
                  </tr>
                ) : null;
              if (showTiers) lastTier = row.tier;
              // A MARKET-ORDER ROW IS ORDERED BY THE MARKET, so an edge against the market would be
              // the ordering compared with itself. `overallRank` is null on exactly those rows, so
              // this reads null and the cell renders its own honest dash.
              const edge = row.marketAdp === null || row.overallRank === null ? null : row.marketAdp - row.overallRank;
              const vsMarket = vsMarketLabel(edge);
              const dollarValue = dollarValues.get(row.playerId) ?? null;
              // Fix 1 (board persona review): on a position tab, positional rank leads and the
              // overall rank becomes the sub-fact — never a bare overall number on its own. On
              // "Overall" there is no single position context to lead with, so the overall rank
              // stays the lead, unchanged. A market-order row leads with its place in the MARKET's
              // order, which is the only ordering it has.
              const leadingRank =
                row.marketOrderRank ?? (position === "ALL" ? row.overallRank : (row.positionRankInValue ?? row.overallRank));
              return (
                <Fragment key={row.playerId}>
                  {tierRow}
                  <tr className="border-b border-line/50">
                    <td className="px-2 py-2 tabular-nums text-text-faint">
                      <div className="flex flex-col">
                        <span className="font-medium text-text-primary">{leadingRank}</span>
                        {position === "ALL" || row.overallRank === null ? null : (
                          <span className="text-xs text-text-faint">{`#${row.overallRank} overall`}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <PlayerFace player={toPlayer(row)} size="sm" />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium text-text-primary">{row.name}</span>
                          <span className="text-xs text-text-faint">
                            {row.team} · bye {row.byeWeek ?? "?"}
                          </span>
                        </div>
                        <PositionBadge position={row.position} rank={row.positionRankInValue ?? undefined} size="sm" className="ml-1" />
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium text-text-primary">
                      {row.projectedPoints === null ? (
                        <>
                          <span aria-hidden="true" className="font-normal text-text-faint">
                            {NOT_STARTED_DASH}
                          </span>
                          <span className="sr-only">No projection for this position</span>
                        </>
                      ) : (
                        row.projectedPoints.toFixed(1)
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-text-muted">
                      {/* The everyday band leads (p25-p75, "most seasons"), the tail band rides
                          behind it in the accessible name and the faint sub-line — founder,
                          2026-09-04: the honest p10-p90 stays measured, the TELLING gets kinder.
                          A row with no projection has no band either, and says so. */}
                      {(() => {
                        if (row.medianPoints === null || row.floorPoints === null || row.ceilingPoints === null) {
                          return (
                            <>
                              <span aria-hidden="true" className="text-text-faint">
                                {NOT_STARTED_DASH}
                              </span>
                              <span className="sr-only">No range for this position</span>
                            </>
                          );
                        }
                        const { p25, p75 } = quartilesFromSeasonBand(row.medianPoints, row.floorPoints, row.ceilingPoints);
                        const floor = row.floorPoints;
                        const ceiling = row.ceilingPoints;
                        return (
                          <span aria-label={`Most seasons ${p25.toFixed(0)} to ${p75.toFixed(0)} points; the full range with injury tails runs ${floor.toFixed(0)} to ${ceiling.toFixed(0)}.`}>
                            <span className="text-text-primary">{p25.toFixed(0)}–{p75.toFixed(0)}</span>
                            <span aria-hidden="true" className="block text-xs text-text-faint">
                              tails {floor.toFixed(0)}–{ceiling.toFixed(0)}
                            </span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-text-muted">
                      {row.marketAdp === null ? (
                        <>
                          <span aria-hidden="true">{NOT_STARTED_DASH}</span>
                          <span className="sr-only">No market data</span>
                        </>
                      ) : (
                        row.marketAdp.toFixed(1)
                      )}
                    </td>
                    <td className="px-2 py-2 text-right text-sm">
                      {vsMarket === null ? (
                        <>
                          <span aria-hidden="true">{NOT_STARTED_DASH}</span>
                          <span className="sr-only">No comparison against the market yet</span>
                        </>
                      ) : (
                        <span className={vsMarket.tone === "positive" ? "font-medium text-positive" : "text-text-muted"}>{vsMarket.text}</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => setDrawer({ row })} className="text-sm font-medium text-accent hover:underline">
                        why
                      </button>
                    </td>
                    {dollarView ? <td className="px-2 py-2 text-right tabular-nums font-medium text-text-primary">${dollarValue}</td> : null}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-faint">
        Projected is his season point total under the scoring selected above, built from the evidence. Most seasons is where the middle half of his
        measured outcomes land; the faint tails line is the full range, injury seasons and smash seasons included. Both come from the same measured spread of games played and per-game scoring. Why opens the full evidence chain: every
        law that fired, its measured effect, and the seasons it was tested against. Nothing on this board is an opinion.
      </p>

      {drawer === null ? null : <EvidenceDrawer state={drawer} laws={laws} onClose={() => setDrawer(null)} />}
    </div>
  );
}
