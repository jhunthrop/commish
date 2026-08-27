import { z } from "zod";
import { isPrintableDisplayName } from "@/identity/display-name";
import { LEAGUE_CONFIG } from "@/league";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { formatUsd, MONEY_CONFIG } from "@/money/config";

import { FREE_SEASON_ENTRY_FEE_MESSAGE, leagueMoneyOrRefuse } from "./creation";

/**
 * Re-exported from `./creation`, where the sentence now lives beside `leagueMoneyOrRefuse` — the
 * rule that carries it at every layer (Task 8 review's defense-in-depth fix). Existing consumers
 * (the schema test, the copy sweep) keep importing it from here unchanged.
 */
export { FREE_SEASON_ENTRY_FEE_MESSAGE } from "./creation";

/**
 * Both names a member chooses: the league's and their team's.
 *
 * The printable guard is the same one the profile PATCH uses, and it is here for a sharper reason
 * than "a name renders on a page". A league name is interpolated into copy the PLATFORM writes in
 * its own voice — the autopick notice's "The clock ran out on pick 24 in <league>" — and ruling 12
 * stores that rendered sentence verbatim and never re-renders it. A `U+202E` planted in a league
 * name would therefore reverse the platform's own words in every affected member's inbox for the
 * life of the row, and no later fix to this schema could repair the rows already written, because
 * repairing stored copy is what ruling 12 forbids. React's escaping is no help: a bidi override is
 * legitimate text, not markup.
 */
const name = z
  .string()
  .trim()
  .min(1, { message: "Please enter a name." })
  .max(LEAGUE_CONFIG.maxNameLength, { message: `Please keep this to ${LEAGUE_CONFIG.maxNameLength} characters or fewer.` })
  .refine(isPrintableDisplayName, { message: "Please use only characters people can see." });

/**
 * Every field except the name has a default, because the spec's exit criterion is that a
 * commissioner goes from signed in to an invitable league in a handful of interactions by
 * accepting defaults. `{ "name": "Sunday Money" }` is a complete request body.
 *
 * `teamCount` is bounded here and nowhere else: creation is the only moment a league's size
 * is chosen, so `LEAGUE_CONFIG.minTeams`/`maxTeams` are enforced at this boundary rather than
 * re-checked by every downstream consumer (the schedule generator, for one, is happy with
 * fewer teams than a real league should ever have).
 */
export const createLeagueSchema = z.object({
  name,
  format: z.enum(["snake", "auction"]).default(LEAGUE_CONFIG.defaults.format),
  teamCount: z
    .number()
    .int()
    .min(LEAGUE_CONFIG.minTeams, { message: `A league needs at least ${LEAGUE_CONFIG.minTeams} teams.` })
    .max(LEAGUE_CONFIG.maxTeams, { message: `A league can have at most ${LEAGUE_CONFIG.maxTeams} teams.` })
    .default(LEAGUE_CONFIG.defaults.teamCount),
  scoringPreset: z.enum(["standard", "ppr", "half_ppr", "te_premium"]).default(LEAGUE_CONFIG.defaults.scoringPreset),
  /**
   * A TOGGLE on the canonical format, not a separate browse queue (the liquidity ruling) —
   * `createLeague` (`@/league-service/creation`) resolves this to slot rows through
   * `ROSTER_SHAPES` (`@/league/roster-shape`) when no explicit `rosterSlots` are given.
   */
  rosterShape: z.enum(["standard", "superflex"]).default(LEAGUE_CONFIG.defaults.rosterShape),
  /**
   * The league median game (Phase 3.5, Task 2): opt-in, off by default — a season-structure
   * choice, not a scoring weight, which is why it lives beside `rosterShape` here rather than
   * inside `scoringPreset`. `createLeague` (`./creation`) writes it straight to `leagues.median_
   * game`; `finalizeWeekInTx` (`@/stats-pipeline/finalize`) is the only writer of the weekly
   * number this toggle switches on.
   */
  medianGame: z.boolean().default(false),
  auctionBudget: z
    .number()
    .int()
    .positive({ message: "An auction budget must be more than zero." })
    .default(LEAGUE_CONFIG.defaults.auctionBudget),
  /**
   * Opt-in, and deliberately worded as visibility rather than a boolean flag: "public" here
   * means "listed on the public browse page and joinable without an invite", which is a real
   * decision a commissioner makes, not a checkbox default anybody should trip over.
   */
  visibility: z.enum(["invite_only", "public"]).default("invite_only"),
  /**
   * Phase 3.5, Task 7: the sit-and-go trigger. `'scheduled'` (the default) keeps today's
   * behavior — a chosen or computed `kickoffAt`, unchanged. `'when_full'` fires the draft
   * `MATCHMAKING_CONFIG.sitAndGo.graceSeconds` after the league's last seat fills
   * (`fireWhenFullInTx`, `@/league-service/fill-trigger`), never a second start path. Refused
   * below in combination with `visibility: "invite_only"` — see that check's own message.
   */
  startTrigger: z.enum(["scheduled", "when_full"]).default("scheduled"),
  /** Cosmetic only. Bounded to the tiers `MATCHMAKING_CONFIG` actually labels. */
  stakeTier: z
    .number()
    .int()
    .min(0)
    .max(MATCHMAKING_CONFIG.stakeTiers.length - 1, { message: "Please choose one of the listed stake tiers." })
    .default(0),
  /** Defaults at the route to the creator's own tier, which the route knows and the service does not. */
  experienceTier: z.enum(["beginner", "experienced"]).optional(),
  /** Defaults at the route to the creator's display name, which the route knows and the service does not. */
  teamName: name.optional(),
  /**
   * Phase 4, Task 8: what one seat costs. `0` (the default) is the free league — the only kind
   * this boundary permits until money is live, refused below with `FREE_SEASON_ENTRY_FEE_MESSAGE`.
   * The ceiling is founder decision 8's config value, rendered into the refusal through
   * `formatUsd` so the sentence can never state a bound the server does not enforce (the
   * `depositBelowMinimum` construction).
   */
  entryFeeCents: z
    .number()
    .int()
    .min(0, { message: "An entry fee cannot be negative." })
    .max(MONEY_CONFIG.entryFeeCeilingCents, { message: `An entry fee can be at most ${formatUsd(MONEY_CONFIG.entryFeeCeilingCents)} per seat.` })
    .default(0),
  /** The platform's fixed per-entry fee (decision 10) — its real bound is the arithmetic law
   *  below, which refuses any rake the published prizes do not balance against. */
  platformFeeCents: z.number().int().min(0, { message: "A platform fee cannot be negative." }).default(0),
  /** The published prize table. Shape only here — `leagueMoneyOrRefuse` (below) owns every rule
   *  about places and amounts, so the boundary and the service can never disagree on one. */
  payoutTable: z.array(z.object({ place: z.number().int(), amountCents: z.number().int() })).optional(),
})
  .refine((data) => data.startTrigger !== "when_full" || data.visibility === "public", {
    // `dueDraftsQuery` (`@/draft-service/auto-start`) starts drafts only in public matchmade
    // leagues (`ENFORCED_LEAGUE_SQL`) — a private league whose fill wrote a time nobody pressed
    // would be the control wired to nothing this codebase has already refused five times.
    message: "Leagues that start when they fill are public leagues. Make this one public, or pick a draft time.",
    path: ["startTrigger"],
  })
  .superRefine((data, ctx) => {
    // Phase 4, Task 8 (rewired by the Task 8 review's defense-in-depth fix): the SAME
    // `leagueMoneyOrRefuse` the service layer enforces (`@/league-service/creation`), asked at
    // the boundary so a commissioner's form hears the refusal before a request ever reaches
    // `createLeague` — derived, never retyped. The rule now carries the free-season law ITSELF
    // (founder decision 7: a structurally valid paid league refuses while `moneyIsLive()` is
    // false), so this boundary, `createLeague`, and `writeLeagueInTx`'s backstop all gate the
    // dark season without any layer re-spelling it. The commissioner's own creation-seated team
    // pays no fee today, a hole the money-live task must close before this gate ever opens
    // (see `writeLeagueInTx`'s member-owner team insert). A wholly free league (every default)
    // passes without touching the money vocabulary.
    const money = leagueMoneyOrRefuse(data);
    if (!money.ok) {
      const darkSeason = money.reason === FREE_SEASON_ENTRY_FEE_MESSAGE;
      ctx.addIssue({ code: "custom", message: money.reason, path: [darkSeason ? "entryFeeCents" : "payoutTable"] });
    }
  });

export const createInviteSchema = z.object({
  maxUses: z
    .number()
    .int()
    .positive({ message: "An invite has to be usable at least once." })
    .max(LEAGUE_CONFIG.invite.maxUses, { message: `An invite can be used at most ${LEAGUE_CONFIG.invite.maxUses} times.` })
    .default(LEAGUE_CONFIG.invite.maxUses),
});

export const acceptInviteSchema = z.object({
  teamName: name.optional(),
});

/** `DELETE /api/leagues/[leagueId]/invites`'s body (flow analysis C-03): the code to revoke.
 *  Bounded to the invite alphabet's own length so a wildly malformed value 400s here rather than
 *  reaching a WHERE clause that simply matches nothing. */
export const revokeInviteSchema = z.object({
  code: z.string().length(LEAGUE_CONFIG.invite.codeLength, { message: "That does not look like an invite code." }),
});

/**
 * One week bound for every week-scoped surface, reads included. The GET half of the lineup
 * route used to accept any `week >= 1` while the PUT half capped it at `maxWeeks`; both
 * returned something harmless, but two boundaries for one concept is how they drift.
 */
export const weekNumberSchema = z.number().int().positive().max(LEAGUE_CONFIG.maxWeeks);

/**
 * A caller only ever names the STARTING slots they want; the bench is derived server-side
 * (`setLineup`'s doc comment explains why), so a client that sends BENCH entries too is
 * accepted and those entries are simply recomputed rather than trusted.
 */
/** The commissioner's chosen draft time. `setDraftKickoff` (`./draft-schedule`) is where "in the
 *  future" and "within the clock schedule's ceiling" are enforced — this boundary only checks
 *  that the string is a real ISO instant at all. */
export const setDraftKickoffSchema = z.object({
  kickoffAt: z.iso.datetime({ message: "That does not look like a valid time." }),
});

export const setLineupSchema = z.object({
  weekNumber: weekNumberSchema,
  slots: z
    .array(
      z.object({
        slot: z.enum(["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX", "K", "DEF", "BENCH"]),
        slotIndex: z.number().int().nonnegative(),
        playerId: z.string().min(1).nullable(),
      }),
    )
    .min(1),
});
