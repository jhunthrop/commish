import type { DraftFormat } from "@/domain/league";
import type { RosterShapeName } from "@/domain/roster";
import type { ScoringPresetName } from "@/domain/scoring";
import type { ExperienceTier } from "@/domain/user";
import { LEAGUE_CONFIG } from "@/league";

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
 * `MATCHMAKING_CONFIG.stakeTiers`. `LEAGUE_CONFIG` (`@/league`) is itself pure data (no
 * Postgres, no `Date.now()`) despite living in a directory the client-boundary lint rule blocks
 * client-ROOM code from importing directly — that rule targets `src/*-room/**`, never this
 * directory, so reading `LEAGUE_CONFIG.defaults` here is legal and is how Task 1's half-PPR
 * canon and its roster-shape default reach the catalog with no second place to restate them.
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
}

/**
 * The one shared shape every rung spreads. §4.1's concentration doctrine, held to by a test
 * rather than promised in a comment: the rungs differ only in who may sit down and when the
 * draft starts, never in what game gets played, so every joiner is compatible with every open
 * seat on the whole shelf. Read from `LEAGUE_CONFIG.defaults` rather than restated, so Task 1's
 * half-PPR canon and Task 2's median-game toggle reach the catalog with nothing here to
 * independently fall out of step with them.
 */
const CANON = {
  format: LEAGUE_CONFIG.defaults.format,
  teamCount: LEAGUE_CONFIG.defaults.teamCount,
  scoringPreset: LEAGUE_CONFIG.defaults.scoringPreset,
  rosterShape: LEAGUE_CONFIG.defaults.rosterShape,
  medianGame: false,
  /** Cosmetic only (`MATCHMAKING_CONFIG.stakeDisclosure`) — every rung reads "Free". */
  stakeTier: 0,
} as const;

/**
 * The shelf itself. Three rungs: an open room for anyone (`open_12`), a room the beginner-tier
 * join gate reserves for newer players (`beginner_12`, `@/league-service/join`'s
 * `publicJoinPrecondition`), and a sit-and-go room whose draft has no chosen time at all
 * (`sitandgo_12`) — the one rung `MATCHMAKING_CONFIG.sitAndGo` (Task 7) exists for.
 *
 * `openAtOnce`/`firstKickoffMinutes`/`staggerMinutes` are Model A's dated-draft mechanic: three
 * `open_12` leagues stand open at once, three hours apart, so a visitor at any hour of the
 * evening finds a draft they can actually attend — the half of "like FFPC and Apex" a browse
 * page alone does not give you.
 */
export const HOUSE_CATALOG = {
  rungs: {
    open_12: { experienceTier: "experienced", startTrigger: "scheduled", openAtOnce: 3, firstKickoffMinutes: 180, staggerMinutes: 180, ...CANON },
    beginner_12: { experienceTier: "beginner", startTrigger: "scheduled", openAtOnce: 2, firstKickoffMinutes: 240, staggerMinutes: 240, ...CANON },
    sitandgo_12: { experienceTier: "experienced", startTrigger: "when_full", openAtOnce: 1, firstKickoffMinutes: 0, staggerMinutes: 0, ...CANON },
  },
} as const satisfies { rungs: Record<string, HouseRung> };

/** The one rung-name union, derived from the catalog rather than hand-declared a second time —
 *  `@/league-service/authority.ts`'s `LeagueAuthority.rung` narrows to this the day this module
 *  exists to import it from (Task 12's own docblock says as much). */
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
 */
export function houseKickoffFor(nowIso: string, rung: HouseRung, index: number): string {
  return plusMinutesIso(nowIso, rung.firstKickoffMinutes + index * rung.staggerMinutes);
}

/** The league name a catalog spawn gets: the rung's own label, plus the edition that keeps two
 *  leagues on the same rung from sharing a name. `src/league-service/house-factory.ts`'s only
 *  caller. */
export function houseLeagueName(rung: HouseRungName, edition: number): string {
  return `${HOUSE_RUNG_LABEL[rung]} League ${edition}`;
}
