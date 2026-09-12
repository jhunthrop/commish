"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SegmentGroup, type SegmentOption } from "@/components/ui";
import { BOARD_FORMAT_QUERY_KEY, BOARD_FORMAT_SPECS, BOARD_FORMATS, isBoardFormat, type BoardFormat } from "@/projections/preseason/board-formats";
import { readStoredBoardFormat, storeBoardFormat } from "./scoring-format-preference";

/** The picker's three segments, in the order the formats are defined. */
export const SCORING_FORMAT_OPTIONS: readonly SegmentOption[] = BOARD_FORMATS.map((format) => ({ value: format, label: BOARD_FORMAT_SPECS[format].label }));

/**
 * THE SCORING SELECTOR (the scoring-formats round, 2026-09-08) — PPR / Half PPR / Standard, on the
 * league-free board only. Choosing one is a real navigation (`?format=`), exactly like the league
 * picker beside it, because the format changes numbers computed server-side (which stored board is
 * read, and the value and tier ladder rebuilt from its points), not only what is displayed. The
 * choice is remembered per browser (`scoring-format-preference.ts`) and, when a league-free board
 * opens with no `?format=` in the URL, the remembered format is applied by a replace navigation so
 * the manager lands on the board he last chose without a flash of the default.
 *
 * `explicit` says whether the URL named the format. Only an unnamed load applies the memory: a
 * shared link to `?format=std` shows standard scoring whatever this browser remembers.
 */
export function ScoringFormatPicker({
  value,
  explicit,
  basePath,
  extraQuery = {},
}: {
  readonly value: BoardFormat;
  readonly explicit: boolean;
  readonly basePath: string;
  readonly extraQuery?: Readonly<Record<string, string>>;
}) {
  const router = useRouter();

  const hrefFor = (format: BoardFormat): string => {
    const params = new URLSearchParams(extraQuery);
    params.set(BOARD_FORMAT_QUERY_KEY, format);
    return `${basePath}?${params.toString()}`;
  };

  useEffect(() => {
    if (explicit) return;
    const remembered = readStoredBoardFormat();
    if (remembered !== value) router.replace(hrefFor(remembered));
    // `hrefFor` closes over `basePath`/`extraQuery`, which are stable for a rendered page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explicit, value, router]);

  return (
    <SegmentGroup
      label="Scoring"
      labelled={false}
      options={SCORING_FORMAT_OPTIONS}
      value={value}
      onChange={(next) => {
        if (!isBoardFormat(next)) return;
        storeBoardFormat(next);
        router.push(hrefFor(next));
      }}
    />
  );
}
