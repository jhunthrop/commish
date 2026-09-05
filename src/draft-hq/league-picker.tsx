"use client";

import { useRouter } from "next/navigation";
import { SegmentGroup, type SegmentOption } from "@/components/ui";

/**
 * DRAFT HQ'S SHARED LEAGUE CONTEXT PICKER (spec §2, §3, §5) — a `SegmentGroup` (the allowlisted
 * "segmented filter rail" accent fill, `accent-budget.source.test.ts`) rather than a hand-rolled
 * pill row, so no surface earns its own accent-fill allowlist entry for a case the primitive
 * already covers. Selecting a league is a real navigation (`router.push`), not client state: on
 * every draft-HQ surface today, the league changes numbers computed server-side (the Board's
 * value-over-replacement, the Simulator's evidence pool and roster shape) rather than only what
 * is displayed.
 *
 * `basePath` is the one thing that varies per surface (`/app/draft/board`, `/app/draft/simulator`,
 * `/app/draft/playbook`, …) — moved here from a board-only component (Task 3) once the Simulator
 * needed the identical picker rather than a second, near-copy of it.
 *
 * `extraQuery` (Task 4, the Playbook's own slot advisor) carries every OTHER query param the
 * current page depends on — the Playbook's `?slot=` — through a league change, so switching
 * leagues never silently resets the slot the reader had picked.
 */
export function LeaguePicker({
  options,
  value,
  basePath,
  extraQuery = {},
}: {
  readonly options: readonly SegmentOption[];
  readonly value: string;
  readonly basePath: string;
  readonly extraQuery?: Readonly<Record<string, string>>;
}) {
  const router = useRouter();
  return (
    <SegmentGroup
      label="League"
      labelled={false}
      options={options}
      value={value}
      onChange={(next) => {
        const params = new URLSearchParams(extraQuery);
        if (next !== "next") params.set("league", next);
        const query = params.toString();
        router.push(query === "" ? basePath : `${basePath}?${query}`);
      }}
    />
  );
}
