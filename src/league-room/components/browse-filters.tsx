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
 * A default, always-visible control (Step 6) — not an opt-in disclosure — narrowing on
 * `participationTier`, a DIFFERENT axis from `experienceTier` above: that one is a
 * commissioner's self-declared label for who a league is FOR, this is a computed fact about who
 * is already IN it (`BrowseFilter`'s own docblock, `@/matchmaking/contract`). Options read
 * "Newcomer-friendly"/"Veteran-heavy" rather than the bare tier words — a visitor is choosing a
 * KIND OF ROOM, not the tier vocabulary itself. That is also why no shared account-facing tier
 * label table exists: the one it would have served writes its own copy on purpose (final review
 * F13 deleted `PARTICIPATION_TIER_LABEL`/`_BLURB`, which had no production reader at all).
 */
const PARTICIPATION_OPTIONS = [
  { value: ANY, label: "Any experience level" },
  { value: "newcomer" as const, label: "Newcomer-friendly" },
  { value: "veteran" as const, label: "Veteran-heavy" },
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
 *
 * The stake tier control carries `MATCHMAKING_CONFIG.stakeDisclosure` as its own hint, right
 * where a visitor is about to narrow by "High stakes" and would otherwise wonder what that
 * costs. `PublicLeagueList` repeats the SAME constant once more, below the results it labels —
 * the two sites share one source of truth rather than two copies of the sentence drifting apart.
 */
export function BrowseFilters({ filter }: { readonly filter: BrowseFilter }) {
  return (
    <form method="get" action="/browse" className="grid gap-3 sm:grid-cols-5 sm:items-start">
      <Select label="Draft format" name="format" options={FORMAT_OPTIONS} defaultValue={String(filter.format)} />
      <Select label="Experience" name="experienceTier" options={EXPERIENCE_OPTIONS} defaultValue={String(filter.experienceTier)} />
      <Select
        label="Stake tier"
        name="stakeTier"
        options={STAKE_OPTIONS}
        defaultValue={String(filter.stakeTier)}
        hint={MATCHMAKING_CONFIG.stakeDisclosure}
      />
      <Select
        label="Who's playing"
        name="participationTier"
        options={PARTICIPATION_OPTIONS}
        defaultValue={String(filter.participationTier)}
      />
      <Button type="submit" variant="secondary">
        Show leagues
      </Button>
    </form>
  );
}
