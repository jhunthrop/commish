import type { DraftFormat } from "@/domain/league";
import type { ExperienceTier } from "@/domain/user";
import type { HouseRungName } from "@/matchmaking/house-catalog";
import type { CompositionCategory } from "@/participation/composition";
import type { ParticipationTier } from "@/participation/tier";

/**
 * TYPES ONLY, no runtime code.
 *
 * `PublicLeagueSummary` IS the privacy boundary of public browse, written once: this is the
 * complete set of facts an UNAUTHENTICATED visitor may learn about a league they are not in.
 * Adding a field here is a deliberate disclosure decision, and
 * `src/league-service/browse.test.ts` fails if the wire body ever carries a key this interface
 * does not name.
 *
 * Deliberately absent, and each for a reason: the commissioner's identity and any team or
 * owner name (a stranger has no business learning who plays here), the invite code (a
 * membership capability), the draft id (a gated room), and standings, rosters and chat (all
 * member-only reads today, and there is no reason browse should be the hole in that).
 *
 * `scoringLabel` is the one deliberate exception to "scoring settings stay member-only": it is
 * a DERIVED label (`describeScoring`, `@/scoring`), never the fifteen raw weights, and it is a
 * property of the league being advertised, not of any person in it. A manager cannot evaluate
 * whether to join a league without knowing how it scores, so withholding it would not be
 * privacy, it would just be a worse card. See `browse.ts`'s docblock and the commit that added
 * this field for the fuller reasoning.
 *
 * `compositionCategory` is the SAME kind of exception, and for the same reason `scoringLabel` is:
 * it is a DERIVED bucket, one of three coarse phrases, never the counts it was derived from. Final
 * review F6 is why it is the bucket and not the counts: this field used to be a
 * `{ newcomers, veterans }` pair reduced to its bucket client-side, and an aggregate over N=1 is
 * not an aggregate — at `filledTeams: 1` the raw pair discloses that one manager's computed
 * participation tier to anybody holding the URL, and polling across joins discloses each new
 * member's tier as a delta. The reduction now happens server-side, so the coarse-label discipline
 * is a wire boundary rather than a rendering convention.
 *
 * `draftAt` (Phase 3 Plan D, Task 6) is the tenth field and the newest disclosure decision: a
 * draft's scheduled time is a scheduling fact about the LEAGUE, not about any person in it, and
 * a visitor who can't see it can't tell whether they are free to attend before they join
 * (ruling 15) — exactly the reasoning `scoringLabel` and `compositionCategory` already established
 * for this interface. Formatted by the SAME `formatDraftTime` (`@/league/terms`) `leagueTerms`
 * calls for `LeagueTerms.draftAt`, so the sentence a stranger reads on a browse card and the one
 * a prospect reads on the invite preview can only ever agree.
 *
 * `medianGame` (Phase 3.5, Task 3) is the eleventh field, and the same kind of disclosure
 * decision `draftAt` and `scoringLabel` already are: how a league decides a week is a fact about
 * the LEAGUE, never about any person in it, and a visitor who cannot see it cannot tell what
 * game they would be joining — every team in a median league plays a second result each week
 * that a standard league's teams never do, and that difference belongs on the card, not
 * discovered only after joining.
 *
 * `startTrigger` (Phase 3.5, Task 8) is the twelfth field. A `when_full` league's `draftAt` is
 * computed from a stored `kickoffAt` that is a PLACEHOLDER, not a chosen time (`browseQuery`'s
 * own `WHERE drafts.status = 'scheduled'` plus its `HAVING count(teams.id) < teamCount` mean any
 * `when_full` league browse ever returns is still open — `fireWhenFullInTx` only moves that
 * placeholder once the league is full, which is exactly the moment it stops being joinable and
 * so stops being browsable at all). The card reads this field to render "Starts as soon as it
 * fills" instead of `draftAt`, never both, and never that placeholder date as though somebody
 * chose it.
 *
 * `houseRung` (Phase 3.5 addendum, Task 14) is the thirteenth field, and the same disclosure
 * reasoning every field above already carries: WHO runs a league is a fact about the league, not
 * about any person in it, so it costs nothing to disclose — unlike `commissionerUserId`, which
 * names a PERSON and stays off this interface entirely. Typed `HouseRungName | null` rather than
 * `string`, the narrowed union `@/matchmaking/house-catalog` (Task 13) declares, so a caller that
 * switches on it exhaustively is a compile error away from ever falling silently out of step with
 * the catalog. `null` for every ordinary member league; one of the catalog's own rung names for a
 * league the platform runs. This field never appears on `BrowseFilter` (`browse.test.ts`'s own
 * "refuses to let a filter hide the shelf" pins that) — it is a fact a CARD renders, never an axis
 * a visitor can narrow the shelf by, because a shelf a filter could empty is not "always a seat".
 *
 * A stranger gets what they need to CHOOSE a league and nothing about the people already in it.
 */
export interface PublicLeagueSummary {
  readonly id: string;
  readonly name: string;
  readonly format: DraftFormat;
  readonly experienceTier: ExperienceTier;
  /** A cosmetic tier index — see `MATCHMAKING_CONFIG.stakeTiers`. Never an amount of money. */
  readonly stakeTier: number;
  readonly teamCount: number;
  readonly filledTeams: number;
  /** Derived from the league's scoring weights (`describeScoring`) — never the raw weights. */
  readonly scoringLabel: string;
  /** One of three coarse buckets, never the counts behind it — see this interface's own docblock. */
  readonly compositionCategory: CompositionCategory;
  /** Absolute-plus-relative, e.g. "Saturday 12 September, 7:00 PM UTC (in 3 days)" — see this
   *  interface's own docblock. */
  readonly draftAt: string;
  /** Whether this league plays a median game (Task 2) — see this interface's own docblock. */
  readonly medianGame: boolean;
  /** Which of the two ways this draft's kickoff comes to be set (Task 8) — see this interface's
   *  own docblock for why the card needs this to decide what `draftAt` means. */
  readonly startTrigger: "scheduled" | "when_full";
  /** Which catalog rung a house league came from, or `null` for an ordinary member league — see
   *  this interface's own docblock for the full disclosure reasoning. */
  readonly houseRung: HouseRungName | null;
  /**
   * Phase 3.6, Task 6, the fourteenth field: how many seats are mid-claim right now, a live
   * `seat_holds` count and nothing else — never a person's identity, never a token. The SAME
   * disclosure reasoning `filledTeams` itself already carries: a seat somebody is claiming is a
   * fact about the LEAGUE's capacity, not about any person in it, and a card that hid it would
   * read "9 of 12 seated" while a stranger's own click a moment later found the twelfth already
   * spoken for with no warning at all.
   *
   * Rendered through `SeatMeter` (`@/components/ui/seat-meter`), never a second sentence written
   * here or on any card — that primitive owns the ONE seat sentence for the whole product (F17).
   */
  readonly heldSeats: number;
  /**
   * Phase 3.6, Task 5, the fourteenth field: "15 slots, 1 flex" or "16 slots, 2 flex, superflex"
   * — a derived sentence from the league's stored `roster_slots` rows, through the existing
   * `describeRosterShape` (`@/league/roster-shape`), on the SAME disclosure reasoning
   * `scoringLabel` and `draftAt` already established for this interface: a fact about the
   * league's own shape, never about a person in it. The gauntlet's veteran finding was that the
   * card "looks premium, reads shallow" — this is one of the two cheapest fields that fix it,
   * because the slot rows are already in the database.
   */
  readonly rosterSummary: string;
  /**
   * Phase 3.6, Task 5, the fifteenth field: the two or three week numbers the platform's
   * standard playoff bracket runs across, e.g. `[15, 16, 17]`. The SAME fact for every league on
   * this platform today — `LEAGUE_CONFIG.regularSeasonWeeks` and `LEAGUE_CONFIG.playoffTeams`
   * are global tunables, not a per-league override anything in this codebase writes — so this is
   * not read off a per-row column; `summarizeRow` (`@/league-service/browse.ts`) computes it
   * once, from config, for every row. Raw week numbers rather than a pre-joined sentence (unlike
   * `rosterSummary` above) because the card is the one place that decides how to say "and"
   * between them.
   */
  readonly playoffWeeks: readonly number[];
  /**
   * Phase 3.6, Task 7, the SEVENTEENTH and last field this plan adds (F21): how many times
   * `rollUnfilledDraftInTx` (`@/league-service/roll`) has pushed this SCHEDULED league's kickoff
   * forward because its room was not full at its target time — the founder's "roll until full"
   * ruling, made a wire fact. `0` for a league that has never rolled (every `when_full` league,
   * by construction: Step 2's own model ruling is that only a `'scheduled'` draft's unfilled
   * target is "not due, it is rolled" — a sit-and-go league has no target to roll away from until
   * it fills). Read through `rollNoticeSentence` (`@/matchmaking/roll`), never rendered as a bare
   * number: "This draft moved once..." / "...moved twice..." / "...moved 5 times...", pluralized
   * honestly rather than silently showing a different date than the one a visitor wrote down.
   */
  readonly kickoffRolls: number;
}

/** A normalized browse filter: every field is a concrete value or the "any" sentinel. */
export interface BrowseFilter {
  readonly format: DraftFormat | "any";
  readonly experienceTier: ExperienceTier | "any";
  readonly stakeTier: number | "any";
  /**
   * A DIFFERENT axis from `experienceTier` above, on purpose — see `src/participation/tier.ts`'s
   * own docblock on the third meaning of "tier". `experienceTier` is a commissioner's
   * self-declared label for who a league is FOR; this is a computed fact about who is already
   * IN it, and the two can disagree (a commissioner who declares "beginner" for a league three
   * veterans already filled).
   */
  readonly participationTier: ParticipationTier | "any";
}

/**
 * The whole browse read: the member list AND the house shelf, as two separate lists rather than
 * one list a `houseRung` sort key would fold together (Phase 3.5 addendum, Task 14). A shelf and
 * a list are different promises — the shelf says "these are ours, they draft on time, and there
 * is always another one"; the list says "these are open leagues other people started" — and
 * collapsing them into one ordered array makes the shelf's promise unreadable. Every entry in
 * `house` carries a non-null `houseRung`; every entry in `leagues` carries `null` — `browse.
 * test.ts`'s own first assertion is what keeps the two from ever crossing.
 */
export interface BrowseBody {
  readonly leagues: readonly PublicLeagueSummary[];
  /** Ordered soonest-draft-first — a visitor's actual question is "which one can I attend
   *  tonight", never "which one is newest" (that's the member list's own tiebreaker, and it
   *  answers a different question). Never narrowed by `BrowseFilter` — see `houseRung`'s own
   *  docblock on `PublicLeagueSummary`. */
  readonly house: readonly PublicLeagueSummary[];
}

/**
 * The front door's proof strip (Phase 3.6, Task 4): three numbers a stranger can check, each
 * gated behind its own credibility floor (`MATCHMAKING_CONFIG.proof.floors`) and produced by
 * `proofStats` (`@/league-service/proof`).
 *
 * EVERY FIELD IS NULLABLE, AND NULL MEANS "DO NOT RENDER THIS ROW" — never a placeholder, never
 * a rounded-up substitute, never "coming soon". `any` is the strip's own visibility switch: false
 * exactly when every one of the three is null, so a page never has to re-derive "is there
 * anything to show" from the three fields itself and risk disagreeing with how each one was
 * decided.
 */
export interface ProofStats {
  /** Leagues whose draft has actually run (`in_progress` or `complete`) this season — never a
   *  league merely full and waiting, and never a league from a prior season. `null` below
   *  `MATCHMAKING_CONFIG.proof.floors.leaguesFilled`. */
  readonly leaguesFilled: number | null;
  /** Scheduled drafts a visitor could still join in the next 48 hours, over public leagues only
   *  (`ENFORCED_LEAGUE_SQL`) — a private league's calendar is never disclosed in aggregate.
   *  `null` below `MATCHMAKING_CONFIG.proof.floors.draftsNext48h`. */
  readonly draftsNext48h: number | null;
  /** The review average, always beside its own count — an average with no `n` is a slogan, not
   *  a stat. `null` below `MATCHMAKING_CONFIG.proof.floors.reviewCount`, average and count
   *  together or not at all. */
  readonly rating: { readonly average: number; readonly count: number } | null;
  /** `false` exactly when every field above is `null` — the strip's own render switch. */
  readonly any: boolean;
}
