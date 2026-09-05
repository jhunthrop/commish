"use client";

import { Fragment, useMemo, useState } from "react";
import type { Player } from "@/domain/player";
import { auctionValues, type AuctionShape } from "@/projections/auction/value";
import type { BoardReason } from "@/projections/preseason/board";
import { BottomSheet, EdgeCell, Input, NOT_STARTED_DASH, PlayerFace, PositionBadge, ReasonChip, SegmentGroup, TierDivider, strongestLawReasons } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { Law } from "@/projections/laws/types";
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
 *  `rowToCsv` below writes, in the same order. */
const CSV_HEADER = ["Rank", "Name", "Position", "Team", "Bye", "Evidence pts", "Floor", "Ceiling", "Market ADP", "Edge vs market", "Strongest law", "Auction value"];

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

function rowToCsv(row: BoardRow, dollarValue: number | null): string {
  const strongest = strongestLawReasons(row.reasons, 1)[0];
  const edge = row.marketAdp === null ? "" : (row.marketAdp - row.rank).toFixed(1);
  return [
    String(row.rank),
    row.name,
    row.position,
    row.team,
    row.byeWeek === null ? "" : String(row.byeWeek),
    row.projectedPoints.toFixed(1),
    row.floorPoints.toFixed(1),
    row.ceilingPoints.toFixed(1),
    row.marketAdp === null ? "" : row.marketAdp.toFixed(1),
    edge,
    strongest === undefined ? "" : `${strongest.lawId} (${strongest.effect >= 0 ? "+" : ""}${strongest.effect.toFixed(1)} pts)`,
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
  return (
    <BottomSheet label={`Why ${state.row.name} ranks here`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <PlayerFace player={toPlayer(state.row)} size="lg" />
          <div className="flex flex-col">
            <span className="font-display text-xl font-semibold leading-display text-text-primary">{state.row.name}</span>
            <span className="text-sm text-text-muted">
              {state.row.team} · bye {state.row.byeWeek ?? "?"} · rank {state.row.rank}
            </span>
          </div>
        </div>
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
                Evidence pts
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                Floor–ceiling
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                Market ADP
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                Edge
              </th>
              <th scope="col" className="px-2 py-2">
                Strongest law
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
                <td colSpan={9} className="px-2 py-6 text-center text-sm text-text-muted">
                  No players match this filter.
                </td>
              </tr>
            ) : null}
            {ordered.map((row) => {
              const tierRow =
                showTiers && row.tier !== lastTier ? (
                  <tr key={`tier-${row.playerId}`}>
                    <td colSpan={9} className="pt-3 pb-1">
                      <TierDivider
                        grade={row.tier === 0 ? "S" : row.tier === 1 ? "A" : row.tier === 2 ? "B" : "C"}
                        label={
                          (row.dropToNextTier ?? 0) > 0
                            ? `${row.playersLeftInTier} left, ${row.dropToNextTier!.toFixed(1)} pt cliff`
                            : `${row.playersLeftInTier} left`
                        }
                      />
                    </td>
                  </tr>
                ) : null;
              if (showTiers) lastTier = row.tier;
              const strongest = strongestLawReasons(row.reasons, 1)[0];
              const edge = row.marketAdp === null ? null : row.marketAdp - row.rank;
              const dollarValue = dollarValues.get(row.playerId) ?? null;
              return (
                <Fragment key={row.playerId}>
                  {tierRow}
                  <tr className="border-b border-line/50">
                    <td className="px-2 py-2 tabular-nums text-text-faint">{row.rank}</td>
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
                    <td className="px-2 py-2 text-right tabular-nums font-medium text-text-primary">{row.projectedPoints.toFixed(1)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-text-muted">
                      {row.floorPoints.toFixed(0)}–{row.ceilingPoints.toFixed(0)}
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
                    <td className="px-2 py-2 text-right">
                      <EdgeCell gap={edge} against="the market" />
                    </td>
                    <td className="px-2 py-2">{strongest === undefined ? null : <ReasonChip reason={strongest} registry={laws} compact />}</td>
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
        Edge = market ADP minus our rank. Positive means we rate him earlier than the market. Why opens the full evidence chain: every law that
        fired, its measured effect, and the seasons it was tested against. Nothing on this board is an opinion.
      </p>

      {drawer === null ? null : <EvidenceDrawer state={drawer} laws={laws} onClose={() => setDrawer(null)} />}
    </div>
  );
}
