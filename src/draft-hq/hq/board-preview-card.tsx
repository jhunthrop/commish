"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, PositionBadge, SegmentGroup } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { boardBasisLine, DEFAULT_BOARD_FORMAT, isBoardFormat, type BoardFormat } from "@/projections/preseason/board-formats";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { SCORING_FORMAT_OPTIONS } from "@/draft-hq/board/scoring-format-picker";
import { readStoredBoardFormat, storeBoardFormat } from "@/draft-hq/board/scoring-format-preference";
import type { DraftHqBoardPreviewRow } from "./service";

/**
 * THE HQ BOARD CARD (the scoring-formats round, 2026-09-08) — the top of the board in the format
 * this browser remembers, with the same PPR / Half PPR / Standard segments the board itself
 * carries. All three previews arrive from the server (three rows each), so switching is local
 * state and costs nothing; the choice is written to the same memory the board's picker reads, so
 * the two surfaces agree the next time either opens. The first render is always PPR, the default,
 * and the remembered format is applied after mount so the server and client markup match.
 */
export function BoardPreviewCard({ previews }: { readonly previews: Readonly<Record<BoardFormat, readonly DraftHqBoardPreviewRow[]>> }) {
  const [format, setFormat] = useState<BoardFormat>(DEFAULT_BOARD_FORMAT);

  useEffect(() => {
    setFormat(readStoredBoardFormat());
  }, []);

  const rows = previews[format];

  return (
    <Card as="article" className="flex flex-col gap-2">
      <span className={`${MICRO_LABEL} text-text-faint`}>The Board</span>
      <h2 className="font-display text-lg font-semibold leading-display text-text-primary">Evidence rankings, receipts on every row</h2>
      <SegmentGroup
        label="Scoring"
        labelled={false}
        options={SCORING_FORMAT_OPTIONS}
        value={format}
        onChange={(next) => {
          if (!isBoardFormat(next)) return;
          storeBoardFormat(next);
          setFormat(next);
        }}
      />
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">The board has not been built for this season yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row, index) => (
            <li key={row.playerId} className="flex items-center gap-2 border-b border-line/50 py-1 text-sm last:border-b-0">
              <span className="w-4 tabular-nums text-text-faint">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{row.name}</span>
              <span className="tabular-nums text-text-muted">{row.projectedPoints.toFixed(1)}</span>
              <PositionBadge position={row.position} rank={row.positionRankInValue ?? undefined} size="sm" />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-text-faint">{boardBasisLine(format, PRODUCT_SEASON)}.</p>
      <p className="text-sm text-text-muted">Tiers, floors and ceilings, risk flags, and the evidence behind every rank. Nothing on it is an opinion.</p>
      <Link href={`/app/draft/board?league=generic&format=${format}`} className="text-sm font-medium text-accent hover:underline">
        Open the board
      </Link>
    </Card>
  );
}
