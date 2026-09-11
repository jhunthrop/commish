"use client";

import { useRouter } from "next/navigation";
import { Select, type SelectOption } from "@/components/ui";

/**
 * DRAFT HQ'S SHARED LEAGUE CONTEXT PICKER (spec §2, §3, §5). Selecting a league is a real
 * navigation (`router.push`), not client state: on every draft-HQ surface, the league changes
 * numbers computed server-side (the Board's value-over-replacement, the Simulator's evidence pool
 * and roster shape) rather than only what is displayed.
 *
 * IT IS A SELECT NOW, NOT A SEGMENTED RAIL (Sideline research round, from a measured phone walk).
 * A segmented rail is right for three or four fixed choices; this list is one segment per league
 * the manager drafts in, plus "Next draft" and the generic board. On a real account that wrapped to
 * SEVEN pills across three rows, and the phone screenshot of the board showed no player row at all
 * above the fold — on the product's densest comparison surface, whose whole job (P10) is fitting at
 * least eight objects on a phone screen. A league is a CONTEXT you set once and forget, not a
 * filter you sweep, so it collapses to one 40px control and gives the rows their screen back.
 *
 * `basePath` is the one thing that varies per surface (`/app/draft/board`, `/app/draft/simulator`,
 * `/app/draft/playbook`, …). `extraQuery` (the Playbook's own `?slot=`) carries every OTHER query
 * param the current page depends on through a league change, so switching leagues never silently
 * resets the slot the reader had picked.
 */
export function LeaguePicker({
  options,
  value,
  basePath,
  extraQuery = {},
}: {
  readonly options: readonly SelectOption[];
  readonly value: string;
  readonly basePath: string;
  readonly extraQuery?: Readonly<Record<string, string>>;
}) {
  const router = useRouter();
  return (
    <Select
      label="League"
      options={options}
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        const params = new URLSearchParams(extraQuery);
        if (next !== "next") params.set("league", next);
        const query = params.toString();
        router.push(query === "" ? basePath : `${basePath}?${query}`);
      }}
    />
  );
}
