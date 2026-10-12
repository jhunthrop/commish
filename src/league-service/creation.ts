import type { Db, DbTx } from "@research-ts/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import type { DraftFormat } from "@/domain/league";
import type { RosterShapeName, RosterSlotConfig } from "@research-ts/domain/roster";
import { SCORING_PRESETS, type ScoringPresetName } from "@research-ts/domain/scoring";
import type { Clock } from "@research-ts/domain/timing";
import type { ExperienceTier } from "@/domain/user";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { LEAGUE_CONFIG } from "@/league";
import { ROSTER_SHAPES } from "@research-ts/domain/roster-shape";
import type { HouseRungName, StartTrigger } from "@/matchmaking/house-catalog";
import { prizeTableInvariant, type PrizeTable } from "@/money/prize-table";
import { moneyIsLive } from "@/money/states";
import type { ReferenceCache } from "@/stats-pipeline/reference-cache";
import { MS_PER_DAY } from "./config";
import { ENFORCEMENT_REFUSALS, tierJoinPrecondition } from "./enforcement";
import { writeLeagueScoring } from "./settings";

/**
 * Who a league answers to. Phase 3.5 addendum, Task 13: a member league is commissioned by the
 * person who created it and gets that person's own team seated in the same transaction; a house
 * league is commissioned by nobody (`@/league-service/authority.ts`'s `LeagueAuthority`, Task 12)
 * and gets no team at all — it opens empty, for a stranger to join later.
 *
 * The one type both `createLeague` and `spawnHouseLeagueInTx`
 * (`@/league-service/house-factory.ts`) share, so "who is this league for" is asked once rather
 * than reinvented per caller. `rung` is `HouseRungName` — `@/matchmaking/house-catalog.ts`'s own
 * union, derived from `HOUSE_CATALOG` rather than a second hand-typed one.
 */
export type LeagueOwner =
  | { readonly kind: "member"; readonly userId: string; readonly teamName: string }
  | { readonly kind: "house"; readonly rung: HouseRungName };

/** No Redis connection needed: every existing caller of `createLeague` keeps working untouched. */
const NOOP_REFERENCE_CACHE: Pick<ReferenceCache, "invalidateScoringSettings"> = {
  invalidateScoringSettings: async () => {},
};

export interface LeagueWriteDeps {
  readonly db: Db;
  readonly clock: Clock;
  /** Injected so ids are deterministic in a test and in the seed. `crypto.randomUUID` at the edge. */
  readonly newId: () => string;
  /** The dark/live switch, defaulting to the real `moneyIsLive()` — injectable so a test can
   *  exercise the paid arithmetic without editing shipped state (see `leagueMoneyOrRefuse`). */
  readonly live?: boolean;
  /**
   * Invalidates this new league's cached scoring settings after they're written, no-op by
   * default. `createLeague` is one of two writers of `scoring_settings` today (the other is the
   * seed) — the day a settings-edit route exists, it must call `invalidateScoringSettings` too,
   * and that is the day this becomes a shared helper both call, rather than two call sites that
   * can silently drift apart.
   */
  readonly cache?: Pick<ReferenceCache, "invalidateScoringSettings">;
  /** Defaults to the process-wide logger (`getAuditLogger()`), the same way every other writer here defaults its collaborators. */
  readonly audit?: AuditLogger;
}

export interface CreateLeagueInput {
  readonly name: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly scoringPreset: ScoringPresetName;
  /** Stored as null for a snake league, whatever the caller passes. */
  readonly auctionBudget: number | null;
  /**
   * Explicit slot rows, taking precedence over `rosterShape` when both are given. The seeds and
   * the integration test pipeline (`@/league-service/test-support`) pass shapes `ROSTER_SHAPES`
   * doesn't name — a two-slot fixture roster, say — directly through here, unchanged from
   * before this field had a named-shape sibling.
   */
  readonly rosterSlots?: readonly RosterSlotConfig[];
  /**
   * The named shape to resolve through `ROSTER_SHAPES` (`@research-ts/domain/roster-shape`) when
   * `rosterSlots` is omitted, falling back to `LEAGUE_CONFIG.defaults.rosterShape` when this is
   * omitted too. Never stored as a column — `leagues.roster_slots` holds only the resolved
   * rows, and `describeRosterShape` is what re-derives a name from them later, the identical
   * "the preset name was never stored" treatment `scoringPreset` gets above.
   */
  readonly rosterShape?: RosterShapeName;
  /**
   * The league median game (Phase 3.5, Task 2): every team also plays the league's own median
   * score each week, and that result counts a real win/loss/tie in the standings. Optional and
   * defaults to `false` — a season-structure toggle nobody is required to opt into, the same
   * "every field but the name has a default" shape every other field on this input follows.
   */
  readonly medianGame?: boolean;
  /**
   * Who commissions this league — a member (with their own team seated) or the house (no
   * commissioner, no team, `@/league-service/authority.ts`'s `LeagueAuthority`). Phase 3.5
   * addendum, Task 13: this REPLACES the earlier `commissionerUserId`/`teamName` pair, which
   * could only ever say "a member", the one shape this function used to be able to create.
   */
  readonly owner: LeagueOwner;
  /** Who the league is advertised for on public browse. Defaults from the creator at the route. */
  readonly experienceTier: ExperienceTier;
  /** Cosmetic tier index only — no entry fee is charged and no balance exists in this phase. */
  readonly stakeTier: number;
  /**
   * Phase 4, Task 8: what one seat costs, in cents, fixed at creation forever — `0` (the
   * default) IS the free league, and the only kind the boundary permits until money is live
   * (`createLeagueSchema`'s free-season refusal). Bounded by `MONEY_CONFIG.entryFeeCeilingCents`
   * at that same boundary; here the invariant below is what holds it honest against the table.
   */
  readonly entryFeeCents?: number;
  /** The platform's fixed per-entry fee (founder decision 10: fixed, NEVER percent-of-pool),
   *  collected at settlement's sweep — named at creation because the published prize table must
   *  balance against it to the cent. */
  readonly platformFeeCents?: number;
  /**
   * The published prize table, fixed in advance (founder decision 9: no proration, ever).
   * REQUIRED to balance whenever any money field is set: `leagueMoneyOrRefuse` holds
   * `sum(prizes) + rake × seats = fee × seats` exactly (`prizeTableInvariant`,
   * `@/money/prize-table`) or `createLeague` refuses before its transaction ever opens. `null`
   * (or an empty table) for a free league — stored as `NULL`.
   */
  readonly payoutTable?: PrizeTable | null;
  /** Opt-in. A league is invite-only and unlisted unless its creator chose otherwise. */
  readonly isPublicMatchmade: boolean;
  /**
   * Phase 4.5, Task 5: `true` for exactly one caller — `createMockRoom`
   * (`@/mock-draft-service/creation`), which reaches `writeLeagueInTx` directly, inside its own
   * transaction, the same way the house factory does. Every other door leaves this unset and
   * every league they create stays a real league (`?? false` in the insert below). A caller that
   * ever set this `true` alongside `isPublicMatchmade: true` would not create a leaky mock — the
   * row refuses to commit at the database (`leagues_mock_private_ck`, `@research-ts/db/schema`), which is
   * the CHECK's whole reason to exist.
   */
  readonly isMock?: boolean;
  /**
   * ISO instant. Optional: the creation form itself never collects this (Task 6 only wires the
   * schedule PANEL, reachable after a league exists, not a creation-time field), but a caller
   * who already has a real chosen time — a seed, a fixture, a future creation flow — should not
   * have to create the league blind and immediately follow with `setDraftKickoff`. Omitted, the
   * SAME `LEAGUE_CONFIG.defaults.draftDaysFromCreation` arithmetic this function has used since
   * Phase 1 still runs, so every existing caller is unaffected.
   */
  readonly kickoffAt?: string;
  /**
   * Phase 3.5, Task 7: which of the two ways this draft's `kickoff_at` will come to be set.
   * Defaults `'scheduled'` — every existing caller of `createLeague` is unaffected. `'when_full'`
   * is the sit-and-go trigger: `fireWhenFullInTx` (`./fill-trigger`) moves `kickoffAt` on its own
   * the moment the league's last seat fills, and nothing here enforces "public leagues only" —
   * that boundary is `createLeagueSchema`'s (`./schemas`), the one place a domain rule like this
   * is enforced, the same precedent `teamCount`'s own bounds already set.
   */
  readonly startTrigger?: StartTrigger;
}

export type CreateLeagueResult =
  | { readonly ok: true; readonly leagueId: string; readonly teamId: string | null; readonly draftId: string }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/** The ids `writeLeagueInTx` writes with — `teamId` is `null` for a house owner, since no team
 *  row is ever inserted for one (Task 13, Step 4). */
export interface LeagueWriteIds {
  readonly leagueId: string;
  readonly teamId: string | null;
  readonly draftId: string;
}

/** `claimed` is `false` exactly once in practice: a house owner's deterministic id
 *  (`house_${rung}_${edition}`, `@/league-service/house-factory.ts`) already exists because
 *  another reconciler instance won the same race first. A member owner's id is a fresh
 *  `crypto.randomUUID()` and can never collide, so `claimed` is always `true` for one. */
export interface LeagueWriteOutcome {
  readonly claimed: boolean;
}

/** The money shape a league is created with, once validated — what `writeLeagueInTx` stores. */
export interface LeagueMoneyConfig {
  readonly entryFeeCents: number;
  readonly platformFeeCents: number;
  readonly payoutTable: PrizeTable | null;
}

export type LeagueMoneyOutcome = { readonly ok: true; readonly config: LeagueMoneyConfig } | { readonly ok: false; readonly reason: string };

/**
 * The refusal for a paid league asked for before the founder has named a launch state
 * (`moneyIsLive`, `@/money/states` — the phase's one dark/live switch). Lives beside
 * `leagueMoneyOrRefuse`, the rule that carries it at every layer; `./schemas` re-exports it so
 * the boundary test and the copy sweep keep reading the same words the refusal carries.
 */
export const FREE_SEASON_ENTRY_FEE_MESSAGE = "Every league is free this season. An entry fee cannot be charged until paid play opens.";

/**
 * Phase 4, Task 8: the creation-time half of founder decision 10's arithmetic law, applied to
 * the fields THIS request asks to create — the same "ask the one predicate before the row
 * exists" shape the tier gate above takes with `tierJoinPrecondition`. A wholly free league
 * (fee `0`, platform fee `0`, no table — every field's default) passes untouched with its table
 * normalized to `null`; ANY money field set makes the full invariant binding:
 * `prizeTableInvariant` (`@/money/prize-table`) holds `sum(prizes) + rake × seats` to the pot
 * exactly, which also refuses the incoherent halves for free (a fee with no table, a table with
 * no fee, a platform fee on a free league — each leaves the identity unbalanced). Pure, so the
 * boundary schema, `createLeague` and any test can ask it without a connection.
 */
export function leagueMoneyOrRefuse(
  input: Pick<CreateLeagueInput, "teamCount" | "entryFeeCents" | "platformFeeCents" | "payoutTable">,
  // Defaulted so every production layer (the boundary schema, `createLeague`, `writeLeagueInTx`'s
  // backstop) carries the dark-season gate FOR FREE — defense in depth the Task 8 review asked
  // for, after finding the gate lived only in the schema and one future direct caller of
  // `createLeague` away from a paid league with a free commissioner seat. Tests exercising paid
  // arithmetic pass `live: true` explicitly; nothing in production does until decision 7's list
  // gains a state.
  live: boolean = moneyIsLive(),
): LeagueMoneyOutcome {
  const entryFeeCents = input.entryFeeCents ?? 0;
  const platformFeeCents = input.platformFeeCents ?? 0;
  const payoutTable = input.payoutTable == null || input.payoutTable.length === 0 ? null : input.payoutTable;
  if (entryFeeCents === 0 && platformFeeCents === 0 && payoutTable === null) {
    return { ok: true, config: { entryFeeCents: 0, platformFeeCents: 0, payoutTable: null } };
  }
  if (!live) return { ok: false, reason: FREE_SEASON_ENTRY_FEE_MESSAGE };
  const invariant = prizeTableInvariant(entryFeeCents, platformFeeCents, input.teamCount, payoutTable ?? []);
  if (!invariant.ok) return { ok: false, reason: invariant.reason };
  return { ok: true, config: { entryFeeCents, platformFeeCents, payoutTable } };
}

/**
 * The one write shape a league ever gets, run INSIDE a transaction the caller already holds
 * open. `createLeague` (below) wraps this in its own `db.transaction`, one call per member
 * league; `spawnHouseLeagueInTx` (`@/league-service/house-factory.ts`) runs it inside the
 * reconciler's own per-league transaction instead, one call per catalog spawn. Factoring the
 * writes out to here — rather than the reconciler hand-writing a second `leagues`/
 * `scoring_settings`/`drafts` insert of its own — is Task 13 Step 3's own argument: "the
 * alternative is a second league-creation transaction that would drift from the first the day
 * anything is added to a league at creation."
 *
 * `ON CONFLICT (id) DO NOTHING` on the `leagues` insert is what makes a house owner's
 * deterministic id idempotent (ruling 35, Task 13 Step 5): two reconciler instances racing for
 * the same edition compute the same id, one INSERT wins the primary key, the other returns zero
 * rows and this function reports `{ claimed: false }` rather than throwing. A member owner's
 * fresh UUID never conflicts, so the clause is a no-op for that branch — one insert statement,
 * not two, for the two owners.
 *
 * A conflict short-circuits everything after it: no `scoring_settings`, no `teams`, no `drafts`,
 * no audit event. The row that already exists was written by whichever transaction actually
 * claimed it, in full, inside its own commit — writing any of THIS transaction's dependent rows
 * against an id it does not own would be a scoring-settings row racing its own league.
 */
export async function writeLeagueInTx(
  tx: DbTx,
  ids: LeagueWriteIds,
  input: CreateLeagueInput,
  kickoffAt: Date,
  clock: Clock,
  audit: AuditLogger,
  /** Injected dark/live switch, defaulting to the real one — tests exercising paid arithmetic
   *  pass `true`; production callers pass nothing (see `leagueMoneyOrRefuse`'s own docblock). */
  live: boolean = moneyIsLive(),
): Promise<LeagueWriteOutcome> {
  // Explicit rows win when given (the seeds' and the test pipeline's own escape hatch);
  // otherwise the named shape resolves through `ROSTER_SHAPES`, falling back to the configured
  // default shape when neither is given — the identical fallback chain `kickoffAt` uses below.
  const rosterSlots = input.rosterSlots ?? ROSTER_SHAPES[input.rosterShape ?? LEAGUE_CONFIG.defaults.rosterShape];

  // Phase 4, Task 8. Re-validated HERE — not only in `createLeague` — because this function is
  // also the house factory's write path (`spawnHouseLeagueInTx` never passes through
  // `createLeague`): a config that fails the arithmetic law is a caller bug this deep, so it
  // throws and rolls the transaction back rather than storing a prize table settlement could
  // never balance. `createLeague` refuses the same input politely before any transaction opens.
  const money = leagueMoneyOrRefuse(input, live);
  if (!money.ok) throw new Error(`writeLeagueInTx: ${money.reason}`);

  const [insertedLeague] = await tx
    .insert(leagues)
    .values({
      id: ids.leagueId,
      name: input.name,
      format: input.format,
      teamCount: input.teamCount,
      commissionerUserId: input.owner.kind === "member" ? input.owner.userId : null,
      houseRung: input.owner.kind === "house" ? input.owner.rung : null,
      rosterSlots: [...rosterSlots],
      experienceTier: input.experienceTier,
      stakeTier: input.stakeTier,
      isPublicMatchmade: input.isPublicMatchmade,
      isMock: input.isMock ?? false,
      medianGame: input.medianGame ?? false,
      entryFeeCents: money.config.entryFeeCents,
      platformFeeCents: money.config.platformFeeCents,
      payoutTable: money.config.payoutTable,
    })
    .onConflictDoNothing()
    .returning({ id: leagues.id });
  if (insertedLeague === undefined) return { claimed: false };

  // THE SETTINGS ROW AND `leagues.scoring_hash` TOGETHER (peek document design §3.2) — one write
  // path, so a league is never committed carrying weights its stored hash does not describe.
  await writeLeagueScoring(tx, clock, { leagueId: ids.leagueId, rules: SCORING_PRESETS[input.scoringPreset] });
  if (input.owner.kind === "member") {
    await tx.insert(teams).values({ id: ids.teamId!, leagueId: ids.leagueId, userId: input.owner.userId, name: input.owner.teamName });
  }
  await tx.insert(drafts).values({
    id: ids.draftId,
    leagueId: ids.leagueId,
    format: input.format,
    status: "scheduled",
    kickoffAt,
    auctionBudget: input.format === "auction" ? input.auctionBudget : null,
    startTrigger: input.startTrigger ?? "scheduled",
  });
  await audit.record(tx, {
    eventType: "league_created",
    actorId: input.owner.kind === "member" ? input.owner.userId : null,
    actorType: input.owner.kind === "member" ? "user" : "system",
    leagueId: ids.leagueId,
    payload: {
      name: input.name,
      format: input.format,
      teamCount: input.teamCount,
      stakeTier: input.stakeTier,
      isPublicMatchmade: input.isPublicMatchmade,
      experienceTier: input.experienceTier,
      scoringPreset: input.scoringPreset,
      medianGame: input.medianGame ?? false,
    },
    occurredAt: clock.now(),
  });
  return { claimed: true };
}

/**
 * A league is never half-created: the league row, its scoring settings, the commissioner's own
 * team (a member owner only) and the scheduled draft all land in ONE transaction. A commissioner
 * left holding a league they have no team in — or a league with no draft to open — is exactly
 * the dead end the UX review's C5 finding is about.
 *
 * The draft is scheduled `LEAGUE_CONFIG.defaults.draftDaysFromCreation` out so the
 * auto-tightening clock starts in a slow tier rather than at the 60-second floor.
 *
 * THE CREATION-SIDE GATE (Task 3, ruling 6). `publicJoinPrecondition` (`@/league-service/join`)
 * never runs for a league's OWN creator — a creator does not join their own league through the
 * public door, so the join gate alone leaves the exact hole the segregation exists to prevent: a
 * veteran declares their own public league `beginner` and simply waits for it to fill. This reads
 * the SAME `tierJoinPrecondition` (`@/league-service/enforcement`) the join gate reads, against
 * the fields THIS request is asking to create rather than a row already in `leagues` — the one
 * predicate, asked before either league exists, the other before a caller may enter one.
 *
 * Only asked for a MEMBER owner (Task 13, ruling 39): `leagues.experience_tier` is self-declared
 * by whoever creates the league, and the abuse this predicate exists to catch is a PERSON
 * declaring a tier they do not belong to in order to sit in it themselves. The platform declares
 * the catalog and then sits in nothing, so a house owner has no `userId` for this to check —
 * `spawnHouseLeagueInTx` walks past this gate entirely rather than this function inventing a
 * vacuous pass for it.
 *
 * NO-WRITE-BEFORE-COMMITTED-REFUSAL: this check runs BEFORE `db.transaction(...)` is ever opened,
 * not inside it and rolled back — a refused creation writes nothing, ever, not even inside a
 * transaction nobody sees commit.
 */
export async function createLeague(
  { db, clock, newId, cache = NOOP_REFERENCE_CACHE, audit = getAuditLogger(), live = moneyIsLive() }: LeagueWriteDeps,
  input: CreateLeagueInput,
): Promise<CreateLeagueResult> {
  // Phase 4, Task 8: the money shape refuses FIRST — pure arithmetic, cheaper than the tier
  // gate's queries, and a table that cannot balance should never cost a database round trip.
  const money = leagueMoneyOrRefuse(input, live);
  if (!money.ok) return { ok: false, status: 400, reason: money.reason };

  if (
    input.owner.kind === "member" &&
    (await tierJoinPrecondition(db, { isPublicMatchmade: input.isPublicMatchmade, experienceTier: input.experienceTier }, input.owner.userId))
  ) {
    return { ok: false, status: 409, reason: ENFORCEMENT_REFUSALS.create };
  }

  const leagueId = newId();
  const teamId = input.owner.kind === "member" ? newId() : null;
  const draftId = newId();
  const kickoffAt =
    input.kickoffAt !== undefined
      ? new Date(input.kickoffAt)
      : new Date(Date.parse(clock.now()) + LEAGUE_CONFIG.defaults.draftDaysFromCreation * MS_PER_DAY);

  let outcome: LeagueWriteOutcome | undefined;
  try {
    await db.transaction(async (tx) => {
      outcome = await writeLeagueInTx(tx, { leagueId, teamId, draftId }, input, kickoffAt, clock, audit, live);
    });
  } catch (error: unknown) {
    // Plain language out, real detail into the logs — never raw driver text to a user.
    console.error("[league] create failed", { owner: input.owner }, error);
    return { ok: false, status: 500, reason: "We could not create that league. Please try again." };
  }
  if (!outcome!.claimed) {
    // Unreachable for a member owner (a fresh UUID never collides); real only for a house
    // owner's deterministic id racing another writer, and `createLeague` is never how the
    // reconciler creates one (`spawnHouseLeagueInTx` calls `writeLeagueInTx` directly, inside
    // its own transaction, so it can report a clean no-op instead of a 500).
    console.error("[league] create lost a primary-key race it should never have entered", { leagueId });
    return { ok: false, status: 500, reason: "We could not create that league. Please try again." };
  }

  // After the transaction commits, never inside it — the same reason `setLineup` invalidates
  // post-commit (`lineups.ts`): an eviction for a write that then rolls back is worse than a
  // brief stale read. Awaited and caught rather than fire-and-forget, so the response cannot
  // outrun the DEL, and a failure is surfaced in the log instead of vanishing into a floating
  // promise.
  try {
    await cache.invalidateScoringSettings(leagueId);
  } catch (error: unknown) {
    console.error("[league] scoring settings cache invalidation failed", { leagueId }, error);
  }

  return { ok: true, leagueId, teamId, draftId };
}
