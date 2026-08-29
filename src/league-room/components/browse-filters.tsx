import Link from "next/link";
import { RAIL_LABEL } from "@/components/ui/config";

/**
 * Phase 3.6, Task 5, Step 4: the shelf's filter row, replacing the four-`Select` form this
 * component used to be. Phase 3.5's ruling 1 — *"variety in toggles, not queues"* — is why the
 * shape changed rather than merely the copy: every `BrowseFilter` axis is a way an open seat
 * could go invisible, and the mock's own six-control row (All, Drafting soonest, Drafts when
 * full, Newer players, Superflex, Median game) is two different things wearing one shape.
 * "Drafting soonest" is a SORT, never a filter — it reorders the same leagues rather than hiding
 * any of them. "Superflex" and "Median game" would fragment the canonical pool for a fact a
 * visitor can already see at a glance on every card (`OpenLeagueCard`'s own eyebrow line and
 * badges) — they are card facts, never filter axes, and this row does not offer them. What
 * remains is four controls, one of which is a sort: All, Drafting soonest, Drafts when full,
 * Newer players.
 *
 * A DIFFERENT shape from the removed `Select` form, but the SAME discipline: plain `<Link>`s,
 * never a client component, so the URL is still the whole filter state — linkable, bookmarkable,
 * shareable, and working before (and without) any JavaScript, on whatever device a stranger with
 * no account happens to have. Mutually exclusive by construction (`ACTIVE_OPTION` below reads
 * exactly one of them as selected), matching the mock's own single-highlighted-pill treatment,
 * rather than four independently combinable toggles this task's own filter-count reduction did
 * not ask for.
 */
export type BrowseFilterOption = "all" | "soonest" | "when_full" | "newer";

const OPTIONS: readonly { readonly key: BrowseFilterOption; readonly label: string; readonly href: string }[] = [
  { key: "all", label: "All", href: "/browse" },
  { key: "soonest", label: "Drafting soonest", href: "/browse?sort=soonest" },
  { key: "when_full", label: "Drafts when full", href: "/browse?whenFull=1" },
  // "Newer players" is the existing `experienceTier` axis (`BrowseFilter.experienceTier`), which
  // exists to keep newer and veteran managers apart on purpose — this pill is a second, plainer
  // entry point into the SAME query parameter `normalizeBrowseFilter` (`@/matchmaking/filter`)
  // already parses, never a new axis.
  { key: "newer", label: "Newer players", href: "/browse?experienceTier=beginner" },
];

export interface BrowseFiltersProps {
  /** Which of the four controls the current URL selects — computed by the caller
   *  (`src/app/browse/page.tsx`, `src/app/page.tsx`) from its own parsed search params, since
   *  this component reads no URL of its own. */
  readonly active: BrowseFilterOption;
}

/**
 * SUNDAY v5 (2026-08-28): the row is a SEGMENTED RAIL, not four floating pills.
 *
 * The approved timing-tower render draws a lens as one joined strip of flat segments with the
 * selected one filled — the shape a broadcast graphic has always used for "which view of the
 * same board am I looking at". Four separate rounded pills say four independent toggles; these
 * are mutually exclusive by construction (`ACTIVE_OPTION`), and the strip is what says so
 * without a sentence.
 *
 * AMBER IS CORRECT HERE, and it is law 4 rather than an exception to it: the amber channel is
 * *"furniture and you and the verb"*, and a filter row is furniture — the network's own graphics,
 * not a verdict about a league and not an act. The `bg-accent` fill therefore earns its
 * `accent-budget.source.test.ts` allowlist entry the way that file asks, in review with a reason.
 * v3's ruling that a lens is "ink-bordered, never filled" was written under the rule where amber
 * (then green) doubled as the one ink action; v5 split those (`accent` for furniture and the
 * verb, the ink pill for the ceremonial act), so a filled segment can no longer be mistaken for
 * this view's primary button.
 *
 * `RAIL_LABEL` is the caps charter's second sanctioned address — the condensed, tracked small
 * caps the rail above this row already speaks in, imported never hand-rolled.
 *
 * Still plain `<Link>`s, still no client component: the URL remains the whole filter state.
 */
const SEGMENT = "px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";

export function BrowseFilters({ active }: BrowseFiltersProps) {
  return (
    <nav
      aria-label="Filter open leagues"
      className="flex w-fit max-w-full flex-wrap items-stretch overflow-hidden rounded-sm border border-edge bg-surface-elevated"
    >
      {OPTIONS.map((option) => {
        const isActive = option.key === active;
        return (
          <Link
            key={option.key}
            href={option.href}
            aria-current={isActive ? "true" : undefined}
            className={`${SEGMENT} ${RAIL_LABEL} border-l border-line first:border-l-0 ${
              isActive ? "bg-accent text-accent-text" : "text-text-muted hover:bg-surface-raised hover:text-text-primary"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
