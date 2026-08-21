import type { IconName } from "@/components/ui/icon";
import { type AuditEvent, type AuditEventType, type JsonObject } from "@/domain/audit";
import { stripHiddenCharacters } from "@/identity/display-name";
import { SYSTEM_ACTION_SUMMARY_ALLOWED } from "./system-actions";

/**
 * Who may see an event type on the member-facing activity feed. `"everyone"` (any league member),
 * `"actor_only"` (only the person who did it), or `"hidden"` (nobody, on this feed, ever).
 */
export type ActivityVisibility = "everyone" | "actor_only" | "hidden";

/**
 * What a league member is allowed to see of their league's audit trail, decided type by type.
 *
 * A `Record` over the whole union and not a partial map: adding an event type without deciding
 * this is a type error, which is the only version of an allowlist that stays honest across four
 * plans. Everything this plan does not publish is `hidden`, so the plan that adds the publisher
 * is the plan that decides what its payload may show.
 *
 * `actor_only` exists for exactly one type. A lineup change is not secret from the league in
 * principle, but it IS competitively sensitive before kickoff: this product locks lineups at
 * kickoff precisely so nobody can react to somebody else's, and a feed that broadcast every
 * bench move would hand back the information the lock exists to protect (ruling 15).
 */
export const ACTIVITY_VISIBILITY: Readonly<Record<AuditEventType, ActivityVisibility>> = {
  league_created: "everyone",
  member_joined: "everyone",
  draft_pick: "everyone",
  draft_completed: "everyone",
  system_action: "everyone",
  lineup_change: "actor_only",
  roster_move: "hidden", // Plan C decides, with its payload
  trade_proposed: "hidden", // Plan C
  trade_accepted: "hidden", // Plan C
  trade_rejected: "hidden", // Plan C
  flag_raised: "hidden", // Plan B: investigatory, admin-only by the spec's own allowlist
  flag_resolved: "hidden", // Plan B
  admin_action: "hidden", // Plan B
  session_started: "hidden", // platform chain: never in a league feed at all
  profile_updated: "hidden", // platform chain
  review_removed: "hidden", // platform chain
};

/**
 * Display names, resolved at READ time from the ids an event's payload carries (ruling 16). A
 * member reading their league's history should never see a uuid, so every implementation falls
 * back to plain language ("A former member", "A player who is no longer listed") for an id that
 * no longer resolves, rather than the id itself or an empty string.
 */
export interface ActivityNames {
  member(userId: string | null): string;
  player(playerId: string): string;
  team(teamId: string): string;
}

/** One line of the member-facing activity feed, already rendered — never a payload to spread. */
export interface ActivityRow {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly icon: IconName;
  readonly headline: string;
  readonly detail: string | null;
}

type Rendered = Omit<ActivityRow, "eventId" | "occurredAt">;

/**
 * Typed payload readers. A field that is missing OR the wrong type reads as `undefined`, never as
 * the JS-coerced string "undefined" — a renderer that needs a field to make sense of an event
 * checks for `undefined` and returns `null` rather than let a malformed or tampered payload reach
 * a headline.
 */
function str(payload: JsonObject, key: string): string | undefined {
  const value = payload[key];
  // STRIPPED here rather than in each renderer, so a renderer a later plan writes inherits the
  // guard instead of having to remember it. Same class as HIGH-2 and milder for the same reason
  // ruling 12 made that one severe: these sentences are re-rendered on every read, so a bidi
  // override in a league name reverses a headline only while the name is hostile rather than
  // forever. Milder is not absent — the guard belongs on both surfaces or on neither.
  return typeof value === "string" ? stripHiddenCharacters(value) : undefined;
}

/**
 * The caller's name resolvers, with the same guard on everything they return.
 *
 * Wrapped ONCE, at the entry point, for the same reason `str` strips rather than each headline
 * doing it: five interpolation sites today and one per renderer forever is a rule somebody
 * eventually forgets, and the failure is silent. These strings come from `users.display_name`,
 * `teams.name` and `players.name` read back out of Postgres — boundary schemas now refuse a
 * hostile one going in, but rows written before those schemas had the guard are still there.
 */
function printableNames(names: ActivityNames): ActivityNames {
  return {
    member: (userId) => stripHiddenCharacters(names.member(userId)),
    player: (playerId) => stripHiddenCharacters(names.player(playerId)),
    team: (teamId) => stripHiddenCharacters(names.team(teamId)),
  };
}

function num(payload: JsonObject, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" ? value : undefined;
}

function renderLeagueCreated(event: AuditEvent, names: ActivityNames): Rendered | null {
  const name = str(event.payload, "name");
  if (name === undefined) return null;
  const teamCount = num(event.payload, "teamCount");
  return {
    icon: "rocket",
    headline: `${names.member(event.actorId)} created the league "${name}".`,
    detail: teamCount === undefined ? null : `${teamCount} teams.`,
  };
}

function renderMemberJoined(event: AuditEvent, names: ActivityNames): Rendered {
  return {
    icon: "users",
    headline: `${names.member(event.actorId)} joined the league.`,
    detail: null,
  };
}

/**
 * `playerId`, `round` and `pickNumber` are required: without all three there is no honest
 * sentence to render, and the alternative ("undefined drafted undefined") is worse than no row.
 *
 * Which sentence renders is decided by `actorType`, never by the payload's own `auto` flag and
 * never by whether `actorId` happens to be null.
 *
 * `actorType` is the DERIVED field: `auditEventsForPicks` (`src/draft-service/audit.ts`) sets it
 * from `pick.auto` and nothing else, so it is the writer's own statement of who acted. `actorId`
 * is not the same fact. Its expression ends `?? null`, and that fallback is a row the writer
 * admits it can emit: a contested auction pick whose owner lookup misses (the team row is gone)
 * carries `actorType: "user"` with `actorId: null`. Branching on the id would render the CLOCK
 * headline for that row, contradicting the audit event's own statement that a person made the
 * pick. `names.member(null)` already has an answer for an unresolvable actor ("A former member"),
 * which is the honest sentence there.
 */
function renderDraftPick(event: AuditEvent, names: ActivityNames): Rendered | null {
  const { payload, actorId } = event;
  const playerId = str(payload, "playerId");
  const round = num(payload, "round");
  const pickNumber = num(payload, "pickNumber");
  if (playerId === undefined || round === undefined || pickNumber === undefined) return null;

  const playerName = names.player(playerId);
  const price = num(payload, "price");
  const detail = `Round ${round}, pick ${pickNumber}.${price === undefined ? "" : ` Won for $${price}.`}`;

  if (event.actorType !== "system") {
    return { icon: "check", headline: `${names.member(actorId)} drafted ${playerName}.`, detail };
  }

  const teamId = str(payload, "teamId");
  if (teamId === undefined) return null;
  return {
    icon: "clock",
    headline: `The clock ran out, so ${names.team(teamId)} drafted ${playerName} from their queue.`,
    detail,
  };
}

function renderDraftCompleted(event: AuditEvent): Rendered {
  const picks = num(event.payload, "picks");
  const teams = num(event.payload, "teams");
  return {
    icon: "trophy",
    headline: "The draft is complete.",
    detail: picks === undefined || teams === undefined ? null : `${picks} picks across ${teams} teams.`,
  };
}

/**
 * Only the manager who made the change sees this row — enforced by `ACTIVITY_VISIBILITY` before
 * this renderer ever runs, so "You" is always correct here, never a guess.
 */
function renderLineupChange(event: AuditEvent): Rendered | null {
  const weekNumber = num(event.payload, "weekNumber");
  if (weekNumber === undefined) return null;
  return { icon: "refresh-cw", headline: `You set your week ${weekNumber} lineup.`, detail: null };
}

/**
 * The contract Plan D writes against: a system action explains itself with its own `summary`
 * string, AND its `action` code has to be one `SYSTEM_ACTION_SUMMARY_ALLOWED` (`./system-actions`)
 * says may say anything to a whole league — or it does not appear at all. No renderer here
 * interprets `action` codes it was not written for — that would be exactly the kind of guess
 * `ACTIVITY_VISIBILITY`'s doc comment warns against, just moved one level down.
 *
 * THE ALLOWLIST CHECK RUNS BEFORE `summary` IS EVEN READ. Task 10 closed the pre-wiring gate this
 * docblock used to describe by itself: `renderSystemAction` rendering `payload.summary` verbatim
 * was safe only by accident of what existed (the sole publisher wrote no `summary` at all), and
 * Plan A's own residual required a re-review before anything emitted a league-scoped one.
 * `SYSTEM_ACTION_SUMMARY_ALLOWED` is that re-review's answer, and this is where it is enforced —
 * an action code missing from the table, or present as `false`, denies before `summary` is ever
 * looked at, so a payload carrying a summary for an action nobody signed off cannot render one.
 *
 * The verifier's own event (`scripts/verify-audit-chain.ts`'s `recordDetection`, writing
 * `{ action: "chain_verification_failed", scopes, checkedAt }`, no `summary`) is denied on BOTH
 * grounds today — it has no `summary` to read, and even if it grew one `chain_verification_failed`
 * is `false` in the table (ruling 8: telling a league its record may have been tampered with,
 * before a human has read the output, is the accusation this phase spends a denylist preventing).
 *
 * A Plan D author reading this: the renderer is INERT until an action is both ALLOWED in
 * `SYSTEM_ACTION_SUMMARY_ALLOWED` and carries a `summary`. `activity-view.test.ts` pins all three
 * denial states, and the mutation proof is that deleting this guard reddens a test rather than
 * nothing.
 */
function renderSystemAction(event: AuditEvent): Rendered | null {
  const action = str(event.payload, "action");
  const allowed = action !== undefined && (SYSTEM_ACTION_SUMMARY_ALLOWED as Readonly<Record<string, boolean | undefined>>)[action] === true;
  if (!allowed) return null;
  const summary = str(event.payload, "summary");
  if (summary === undefined) return null;
  return { icon: "alert-triangle", headline: summary, detail: null };
}

/**
 * One renderer per type this plan publishes. Every OTHER type is already turned away by
 * `ACTIVITY_VISIBILITY` before `activityRowFor` reaches this switch, so its `default` case is
 * unreachable through any type this plan knows about — it exists only so a value that somehow
 * fails to match the union (a row from a future migration a running process hasn't reloaded types
 * for) denies rather than throws, the same "not a crash" guarantee the allowlist itself commits to.
 */
function renderPayload(event: AuditEvent, names: ActivityNames): Rendered | null {
  switch (event.eventType) {
    case "league_created":
      return renderLeagueCreated(event, names);
    case "member_joined":
      return renderMemberJoined(event, names);
    case "draft_pick":
      return renderDraftPick(event, names);
    case "draft_completed":
      return renderDraftCompleted(event);
    case "lineup_change":
      return renderLineupChange(event);
    case "system_action":
      return renderSystemAction(event);
    default:
      return null;
  }
}

/**
 * The one entry point Task 10's feed calls per event. Returns `null` whenever visibility denies
 * the type outright, the viewer is not the actor for an `actor_only` type, or the type's renderer
 * cannot make an honest sentence out of the payload it was given.
 *
 * `visibility` is checked against `"everyone"`/`"actor_only"` explicitly rather than against
 * `!== "hidden"`: an event type this process's `ACTIVITY_VISIBILITY` has no entry for (impossible
 * through the `Record<AuditEventType, …>` type today, but not impossible at runtime against a
 * value read back from Postgres) reads as `undefined`, and `undefined` must deny exactly like
 * `"hidden"` does — the deny-by-default guarantee has to hold even where the type system already
 * thinks it is unnecessary.
 */
export function activityRowFor(event: AuditEvent, viewer: { readonly userId: string }, names: ActivityNames): ActivityRow | null {
  const visibility = ACTIVITY_VISIBILITY[event.eventType];
  if (visibility !== "everyone" && visibility !== "actor_only") return null;
  if (visibility === "actor_only" && event.actorId !== viewer.userId) return null;

  const rendered = renderPayload(event, printableNames(names));
  if (rendered === null) return null;
  return { eventId: event.eventId, occurredAt: event.occurredAt, ...rendered };
}
