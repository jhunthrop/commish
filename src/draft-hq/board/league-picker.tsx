"use client";

import { useRouter } from "next/navigation";
import { SegmentGroup, type SegmentOption } from "@/components/ui";

/**
 * THE BOARD'S LEAGUE CONTEXT PICKER (spec §3) — a `SegmentGroup` (the allowlisted "segmented
 * filter rail" accent fill, `accent-budget.source.test.ts`) rather than a hand-rolled pill row,
 * so this surface never earns its own accent-fill allowlist entry for a case the primitive
 * already covers. Selecting a league is a real navigation (`router.push`), not client state: it
 * changes the RECOMPUTED value-over-replacement numbers `board/page.tsx` builds server-side.
 */
export function LeaguePicker({ options, value }: { readonly options: readonly SegmentOption[]; readonly value: string }) {
  const router = useRouter();
  return (
    <SegmentGroup
      label="League"
      labelled={false}
      options={options}
      value={value}
      onChange={(next) => router.push(next === "next" ? "/app/draft/board" : `/app/draft/board?league=${encodeURIComponent(next)}`)}
    />
  );
}
