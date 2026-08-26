import type { DraftFormat } from "@/domain/league";
import type { RosterShapeName } from "@/domain/roster";
import type { ScoringPresetName } from "@/domain/scoring";
import type { ExperienceTier } from "@/domain/user";
import { LEAGUE_CONFIG } from "@/league/config";
import type { PrizeTable } from "@/money/prize-table";

/**
 * "View and join like FFPC and Apex": a shelf of canonical leagues with real draft times,
 * declared here as DATA rather than as rows a script inserts once. `src/league-service/
 * house-factory.ts` (Task 13, Step 4) is the reconciler that keeps the shelf stocked to this
 * declaration; this module owns none of the I/O that takes.
 *
 * PURE, browser-safe, no I/O — the identical discipline `src/matchmaking/config.ts` already
 * holds itself to, and for the identical reason: this directory is one of the client
 * boundary's exempt set (`docs/conventions.md`, "Client boundary"), so a room component may
 * value-import `HOUSE_RUNG_LABEL` exactly as `browse-filters.tsx` already value-imports
 * `MATCHMAKING_CONFIG.stakeTiers`.
 *
 * `@/league/config`, NEVER THE `@/league` BARREL (final whole-branch review, F7). The config
 * module itself is pure data (no Postgres, no `Date.now()`), which is why reading
 * `LEAGUE_CONFIG.defaults` from a browser-reachable module is legal at all — but this file
 * value-imported the BARREL, and a barrel is not a module, it is every module behind it: the
 * schedule generator, the standings and clinch math, the median folds, the lineup rules, the
 * invite-code generator. All of it followed `HOUSE_RUNG_LABEL` into the client bundle, for one
 * frozen object. The direct import is the whole fix, and `eslint.config.mjs` now pins it: the
 * browser-safe exempt directories may reach a `@/league` SUBMODULE and never the barrel.
 */

/** Whether a rung's draft fires at a chosen time or the moment its last seat fills — the same
 *  two-value vocabulary `drafts.start_trigger` already carries (`@/db/schema`), named here so
 *  `HouseRung.startTrigger` and `CreateLeagueInput.startTrigger` (`@/league-service/creation`)
 *  share one type instead of two hand-typed unions that could drift apart. */
export type StartTrigger = "scheduled" | "when_full";

/** Whole days measured in minutes, the unit every rung's stagger and first-kickoff tunable is
 *  expressed in — `houseKickoffFor`'s own arithmetic and `LEAGUE_CONFIG.defaults.maxDraftDaysAhead`
 *  both need it, and one constant is what keeps the two from drifting on the conversion. */
export const MINUTES_PER_DAY = 24 * 60;

/**
 * One shelf rung: who may sit down, when the draft starts, and how many stand open at once.
 * `format`/`teamCount`/`scoringPreset`/`rosterShape` are deliberately part of every rung's own
 * shape rather than hoisted out of it — Step 1's fifth test is what actually enforces that every
 * rung spreads the identical `CANON` for those four fields, so the type stays honest about what
 * is (in principle) allowed to vary rung-to-rung even though nothing here varies it today.
 */
export interface HouseRung {
  readonly experienceTier: ExperienceTier;
  readonly startTrigger: StartTrigger;
  /** How many of this rung stand open at once. The shelf's width. */
  readonly openAtOnce: number;
  /** Minutes from now to the first open league's kickoff. Ignored by a `when_full` rung. */
  readonly firstKickoffMinutes: number;
  /** Minutes between consecutive open leagues of this rung. Ignored by a `when_full` rung. */
  readonly staggerMinutes: number;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly scoringPreset: ScoringPresetName;
  readonly rosterShape: RosterShapeName;
  readonly medianGame: boolean;
  readonly stakeTier: number;
  /**
   * Phase 4, Task 8: what a seat on this rung costs, with the published table the pot pays out
   * through. ALL RUNGS ARE FREE (`0`/`0`/`null`) until money is live — the catalog is config, so
   * flipping a rung to paid is a one-line, founder-visible diff here, held to founder decision
   * 10's arithmetic by `house-catalog.test.ts` running `prizeTableInvariant` over every rung.
   */
  readonly entryFeeCents: number;
  readonly platformFeeCents: number;
  readonly payoutTable: PrizeTable | null;
}

/**
 * The one shared shape every rung spreads. §4.1's concentration doctrine, held to by a test
 * rather than promised in a comment: the rungs differ only in who may sit down and when the
 * draft starts, never in what game gets played, so every joiner is compatible with every open
 * seat on the whole shelf.
 *
 * FOUR of the six fields are read from `LEAGUE_CONFIG.defaults` rather than restated, so Task 1's
 * half-PPR canon and its roster-shape default reach the catalog with nothing here to
 * independently fall out of step with them.
 *
 * THE OTHER TWO ARE LITERALS, and this docblock used to claim otherwise (final whole-branch
 * review, F8): it named Task 2's median-game toggle as one of the values arriving from
 * `LEAGUE_CONFIG.defaults`, and there is no such field there at all — `medianGame` and
 * `stakeTier` are decided HERE, by the catalog, for the catalog. `medianGame: false` is the
 * shelf's own choice (the house rungs play a plain head-to-head week), not a default inherited
 * from anywhere. Whether `LEAGUE_CONFIG.defaults` should GROW a median-game default is a
 * separate, parked question; until it does, this comment says what the code does.
 */
const CANON = {
  format: LEAGUE_CONFIG.defaults.format,
  teamCount: LEAGUE_CONFIG.defaults.teamCount,
  scoringPreset: LEAGUE_CONFIG.defaults.scoringPreset,
  rosterShape: LEAGUE_CONFIG.defaults.rosterShape,
  /** A literal, decided here — see this object's own docblock. */
  medianGame: false,
  /** Cosmetic only (`MATCHMAKING_CONFIG.stakeDisclosure`) — every rung reads "Free". */
  stakeTier: 0,
  /** Phase 4, Task 8: free, whole-shelf, until the founder flips a rung — see `HouseRung`. */
  entryFeeCents: 0,
  platformFeeCents: 0,
  payoutTable: null,
} as const;

/**
 * THE WHOLE SHELF IS SIT-AND-GO (founder directive 2026-08-26). Too many open tournaments at once
 * was the complaint, and a scheduled kickoff that rolls a member to a new time when the room never
 * fills feels bad on top of it — so every rung now drafts the moment its last seat fills
 * (`startTrigger: "when_full"`), never at a chosen clock time. `fireWhenFullInTx`
 * (`@/league-service/fill-trigger.ts`) is the machinery every rung now points at; `sitandgo_12`
 * (below) was simply the rung that machinery was born on.
 *
 * WIDTH DROPS 6 → 2. `open_12` and `beginner_12` each stand exactly one league open at once
 * (`openAtOnce: 1`) — a visitor never finds an empty shelf, because `ensureHouseCatalog`
 * (`@/league-service/house-factory.ts`) is a level-triggered reconciler: the instant a league
 * leaves the shelf (fills, or its draft starts), the next tick opens its replacement. There is
 * no dated kickoff left to stagger, so `firstKickoffMinutes`/`staggerMinutes` are `0` on every
 * rung — the fields stay on `HouseRung` (a future `"scheduled"` rung would need them again) but
 * nothing reads them as anything but zero today.
 *
 * `sitandgo_12` (`openAtOnce: 0`) — RETIRED. `open_12` IS the sit-and-go now, so the shelf never
 * spawns a `sitandgo_12` league again. The key and its label stay in the catalog and in
 * `HouseRungName` because existing rows in `leagues.house_rung` still carry `'sitandgo_12'`, and
 * dropping the key would leave those rows pointing at a rung `HOUSE_RUNG_LABEL`/`HouseRungName`
 * no longer recognize. `ensureHouseCatalog`'s shortfall arithmetic already treats `openAtOnce: 0`
 * as "never short" without a guard (`rung.openAtOnce * 3` attempt ceiling is `0`, and
 * `open.length >= rung.openAtOnce` is true at zero leagues too), so retiring a rung to zero width
 * needed no new code, only this declaration.
 */
export const HOUSE_CATALOG = {
  rungs: {
    open_12: { experienceTier: "experienced", startTrigger: "when_full", openAtOnce: 1, firstKickoffMinutes: 0, staggerMinutes: 0, ...CANON },
    beginner_12: { experienceTier: "beginner", startTrigger: "when_full", openAtOnce: 1, firstKickoffMinutes: 0, staggerMinutes: 0, ...CANON },
    /** RETIRED (founder directive 2026-08-26) — see this constant's own docblock. `open_12` IS
     *  the sit-and-go now; this key and its `HOUSE_RUNG_LABEL` entry are preserved only so
     *  existing `leagues.house_rung = 'sitandgo_12'` rows still resolve to a real rung. */
    sitandgo_12: { experienceTier: "experienced", startTrigger: "when_full", openAtOnce: 0, firstKickoffMinutes: 0, staggerMinutes: 0, ...CANON },
  },
} as const satisfies { rungs: Record<string, HouseRung> };

/** The one rung-name union, derived from the catalog rather than hand-declared a second time —
 *  `@/league-service/authority.ts`'s `LeagueAuthority.rung` imports this (type-only) and narrows
 *  to it (Fix round 1, F1), rather than carrying its own `string`-typed placeholder. */
export type HouseRungName = keyof typeof HOUSE_CATALOG.rungs;

/**
 * The member-facing name for a rung, exhaustive over `HouseRungName` so a rung added without a
 * label does not compile — the same shape `ROSTER_SHAPE_LABEL` (`@/domain/roster`) and
 * `TIER_COMPOSITION_LABEL` (`@/participation/composition`) already use. Swept for copy violations
 * in `house-catalog.test.ts`, this module's own "sweep coverage" `filter.test.ts`'s
 * `MATCHMAKING_CONFIG` describe block already models for `stakeDisclosure`.
 */
export const HOUSE_RUNG_LABEL: Readonly<Record<HouseRungName, string>> = {
  open_12: "Open 12-team",
  beginner_12: "Beginner 12-team",
  sitandgo_12: "Sit and go",
};

/** `nowIso` moved forward by `minutes` whole minutes, as an ISO instant. */
export function plusMinutesIso(nowIso: string, minutes: number): string {
  return new Date(Date.parse(nowIso) + minutes * 60_000).toISOString();
}

/**
 * The `index`-th open league of `rung`'s scheduled kickoff, counting from `now` — `0` for the
 * first of the group, `1` for the second, and so on. Meaningless (and never called) for a
 * `when_full` rung, whose draft has no chosen time to compute at all.
 *
 * DORMANT, NOT DEAD (founder directive 2026-08-26): every rung in `HOUSE_CATALOG` is `when_full`
 * now, so no catalog spawn calls this today — `house-factory.ts`'s own `kickoffFor` only reaches
 * this branch for a `"scheduled"` rung, and there is currently no such rung. Kept, pure and
 * tested, because a rung could turn `"scheduled"` again without this arithmetic needing to be
 * reinvented.
 */
export function houseKickoffFor(nowIso: string, rung: HouseRung, index: number): string {
  return plusMinutesIso(nowIso, rung.firstKickoffMinutes + index * rung.staggerMinutes);
}

/**
 * Curated, sentence-case fun names, one pool per rung, verbatim from the founder's 2026-08-26
 * naming pass — never generated, never a template over the rung's label. `sitandgo_12`'s pool is
 * a single legacy entry: the rung is retired (`HOUSE_CATALOG`'s own docblock), so this pool exists
 * only in case some historical row's display name is ever recomputed.
 */
const HOUSE_NAME_POOL: Readonly<Record<HouseRungName, readonly string[]>> = {
  open_12: [
    "The Blitz Room",
    "Fourth and Long",
    "The Longshot League",
    "Prime Time Twelve",
    "The Two-Minute Drill",
    "Hail Mary Society",
    "The Red Zone Club",
    "Midnight Waivers",
    "The Flea Flicker",
    "Goal Line Stand",
    "The Audible",
    "Play Action Party",
  ],
  beginner_12: [
    "The Rookie Room",
    "First Snap League",
    "The Learning Curve",
    "Fresh Legs League",
    "The Opening Drive",
    "Training Camp Twelve",
    "The First Down Club",
    "Kickoff Classic",
  ],
  sitandgo_12: ["Sit and Go Twelve"],
};

/**
 * The league name a catalog spawn gets. Draws from `rung`'s own pool at `(edition - 1) %
 * pool.length` — the first `pool.length` editions of a rung each get a distinct, un-suffixed
 * pool entry. From the second cycle on, uniqueness needs a suffix too (the pool has wrapped), so
 * every edition past the first cycle gets `` `${entry} ${cycle}` ``, `cycle =
 * Math.ceil(edition / pool.length)` — `2` for the whole second lap through the pool, `3` for the
 * third, and so on. Editions are monotonic and never reused (`nextEdition`,
 * `@/league-service/house-factory.ts`), so this is unique for a rung's entire lifetime, not just
 * within one lap.
 */
export function houseLeagueName(rung: HouseRungName, edition: number): string {
  const pool = HOUSE_NAME_POOL[rung];
  const entry = pool[(edition - 1) % pool.length]!;
  if (edition <= pool.length) return entry;
  return `${entry} ${Math.ceil(edition / pool.length)}`;
}
