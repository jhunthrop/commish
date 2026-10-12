import type { Db } from "@research/db/client";
import type { Clock } from "@research/domain/timing";
import { LEAGUE_CONFIG } from "@/league";
import { crossLeagueHome } from "@/league-service";
import type { LiveState as HomeLiveState } from "@/league-room/contract";
import type { CreateSheetDefaults } from "@/league-room/components/create-sheet";
import { monogramsFor } from "@/components/ui/monogram";
import {
  needsYouKindFor,
  orderByUrgency,
  railStateFor,
  railStateLine,
  type RailLeagueState,
} from "@/league-room/lib/rail-line";

/**
 * The rail's three-way read of a league (needs-you / live / quiet) lives in
 * `@/league-room/lib/rail-line` now (the rail redesign, 2026-09-03) — one pure module the shell
 * read, the flyout's live upgrade and the `/app` full-page rows all share, so the three sizes of
 * one component can never disagree. Re-exported here so `AppShellProps`/`LeagueRail` callers
 * that only know this module keep working.
 */
export type { RailLeagueState };

/**
 * One league as the rail renders it, in every size (2026-09-03): the chip needs `monogram` and
 * `state`; the flyout row adds `name` and `stateLine`. Ordered by urgency already — needs-you
 * first, live second, quiet after the divider — so no renderer re-sorts.
 *
 * `monogram` is LAW 1's collision-resolved mark (`monogramsFor`, `@/components/ui/monogram`),
 * assigned over the leagues in the read's own stable order (`myLeaguesOverview`: `createdAt`
 * asc) BEFORE the urgency sort, so a league's mark never changes just because its urgency did.
 * The chip's ground color stays `Crest`'s own `crestTone(id)` — nothing here carries a tone.
 *
 * `stateLine` is the SHELL TIER of `railStateLine` (`@/league-room/lib/rail-line`): every rung a
 * real read, and a live league degrades to "Live now" because this read deliberately skips the
 * score cache — the flyout upgrades live rows itself, from `/api/home`, only when it is open.
 *
 * `needsYouKind` keeps its original job (fix round 1, H1): `state === "needs-you"` collapses two
 * distinct facts and the accessible name has to say which.
 */
export interface RailLeague {
  readonly id: string;
  readonly name: string;
  readonly state: RailLeagueState;
  readonly needsYouKind: "fix-lineup" | "join-draft" | null;
  readonly monogram: string;
  readonly stateLine: string;
}

/**
 * `LiveState` (Task 10, Step 3) lives on `@/league-room/contract` — `crossLeagueHome` computes it
 * once, from the SAME `stat_weeks` rows it reads for every league's own `weekStatus`, and this
 * module reuses that one computation rather than deriving a second, potentially-disagreeing
 * answer of its own. Re-exported here so a caller that only knows this module (`AppShellProps`,
 * `TopBarProps`) never has to reach into `@/league-room/contract` for a type this seam predates.
 */
export type { HomeLiveState as LiveState };

export interface ShellData {
  readonly rail: readonly RailLeague[];
  readonly liveState: HomeLiveState | null;
}

/**
 * The create sheet's defaults ARE the service's own (`LEAGUE_CONFIG.defaults`) — every server
 * page that mounts `AppShell` (and therefore its `CreateLeagueSheetHost`) reads them through
 * this ONE function rather than re-typing the three-field literal, the front door's own
 * `createDefaults` (`src/app/page.tsx`) included as the pattern this centralizes. Kept alongside
 * `shellData` rather than in `@/league-room/components/create-league-sheet` itself: the client
 * boundary bans a `@/league` value import from that directory, so the read has to live on the
 * server side of the split, same reasoning as `shellData` itself.
 */
export function createSheetDefaults(): CreateSheetDefaults {
  return {
    teamCount: LEAGUE_CONFIG.defaults.teamCount,
    scoringPreset: LEAGUE_CONFIG.defaults.scoringPreset,
    draftDaysFromCreation: LEAGUE_CONFIG.defaults.draftDaysFromCreation,
  };
}

/**
 * The rail's data, once: `{ rail, liveState }` in one round trip, built on the reads
 * `crossLeagueHome` already performs — this function issues no query of its own, and it passes
 * NO score cache on purpose (the rail redesign's own scope rule: the shell renders on every
 * signed-in page, so its read stays the 8 grouped queries, and live margins are the flyout's
 * lazy fetch, never the shell's). Called exactly once per navigation, by
 * `src/app/app/(shell)/layout.tsx` (ruling 8, as amended); nothing else reads the rail twice.
 * `liveState` is `home.liveState` verbatim. `clock` rides straight through to
 * `crossLeagueHome`'s own `CrossLeagueHomeDeps.clock` — optional, defaulting to the real one,
 * injectable only so a test can pin the weekday `liveStateFor` reads.
 */
export async function shellData(db: Db, user: { readonly id: string }, clock?: Clock): Promise<ShellData> {
  const home = await crossLeagueHome(db, user.id, { clock });
  // Marks first, over the stable createdAt order the read returns — then the urgency sort.
  const monogramByLeague = new Map(monogramsFor(home.leagues.map((league) => league.name)).map((mark, index) => [home.leagues[index]!.id, mark]));
  const rail: readonly RailLeague[] = orderByUrgency(home.leagues).map((league) => ({
    id: league.id,
    name: league.name,
    state: railStateFor(league.nextAction?.kind, league.weekStatus),
    needsYouKind: needsYouKindFor(league.nextAction?.kind),
    monogram: monogramByLeague.get(league.id)!,
    stateLine: railStateLine(league, "shell"),
  }));
  return { rail, liveState: home.liveState };
}
