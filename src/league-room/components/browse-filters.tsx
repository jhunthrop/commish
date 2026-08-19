import { Button, Select } from "@/components/ui";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { BrowseFilter } from "@/matchmaking/contract";

const ANY = MATCHMAKING_CONFIG.anyValue;
const FORMAT_LABELS: Readonly<Record<string, string>> = { snake: "Snake", auction: "Auction" };
const TIER_LABELS: Readonly<Record<string, string>> = { beginner: "New to fantasy", experienced: "Played before" };

const FORMAT_OPTIONS = [
  { value: ANY, label: "Any format" },
  ...MATCHMAKING_CONFIG.formats.map((value) => ({ value, label: FORMAT_LABELS[value] ?? value })),
];
const EXPERIENCE_OPTIONS = [
  { value: ANY, label: "Any experience" },
  ...MATCHMAKING_CONFIG.experienceTiers.map((value) => ({ value, label: TIER_LABELS[value] ?? value })),
];
const STAKE_OPTIONS = [
  { value: ANY, label: "Any stake tier" },
  ...MATCHMAKING_CONFIG.stakeTiers.map((entry) => ({ value: String(entry.tier), label: entry.label })),
];

/**
 * Deliberately NOT a client component, and deliberately a plain GET form: the URL IS the
 * filter state, so a filtered browse can be linked, bookmarked, shared and reloaded, and the
 * whole surface works before (and without) any JavaScript. That matters more here than
 * anywhere else in the app — this is the one page a visitor with no account ever sees, on
 * whatever device and connection they happen to have.
 *
 * `defaultValue` rather than `value`: an uncontrolled native control needs no state and no
 * hydration, and the server has already rendered the applied filter into it.
 */
export function BrowseFilters({ filter }: { readonly filter: BrowseFilter }) {
  return (
    <form method="get" action="/browse" className="grid gap-3 sm:grid-cols-4 sm:items-end">
      <Select label="Draft format" name="format" options={FORMAT_OPTIONS} defaultValue={String(filter.format)} />
      <Select label="Experience" name="experienceTier" options={EXPERIENCE_OPTIONS} defaultValue={String(filter.experienceTier)} />
      <Select label="Stake tier" name="stakeTier" options={STAKE_OPTIONS} defaultValue={String(filter.stakeTier)} />
      <Button type="submit" variant="secondary">
        Show leagues
      </Button>
    </form>
  );
}
