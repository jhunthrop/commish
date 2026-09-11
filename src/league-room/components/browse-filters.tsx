import Link from "next/link";
import { chipClassName } from "@/components/ui/segment-group";

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
 * SIDELINE (2026-09-10): the row is PILL CHIPS, the shape `SegmentGroup` already wears and the
 * shape the mock draws — sentence case in the body face, the chosen one filled, the rest resting
 * on the ground. The joined broadcast strip retires with the register that asked for it: v5's
 * segmented rail was a network graphic, and Sideline's chips are what a person taps.
 *
 * NOT `SegmentGroup` itself, deliberately: that primitive is a client component built on
 * `onChange` and `aria-pressed`, and this row is plain `<Link>`s so the URL remains the whole
 * filter state — linkable, bookmarkable, and working before (and without) any JavaScript, on
 * whatever device a stranger with no account happens to have. Different mechanism, ONE skin:
 * the class comes from `chipClassName` (`@/components/ui/segment-group`), the single file in the
 * product that fills a chip, so this file no longer needs an accent-budget exemption at all.
 *
 * `aria-current` rather than `aria-pressed`: these are navigation, and exactly one is the page
 * the reader is standing on.
 */
export function BrowseFilters({ active }: BrowseFiltersProps) {
  return (
    <nav aria-label="Filter open leagues" className="flex w-fit max-w-full flex-wrap gap-1.5">
      {OPTIONS.map((option) => {
        const isActive = option.key === active;
        return (
          <Link
            key={option.key}
            href={option.href}
            aria-current={isActive ? "true" : undefined}
            className={chipClassName(isActive)}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
