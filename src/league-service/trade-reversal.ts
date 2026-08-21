import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbTx } from "@/db/client";
import { leagues, players, rosterSlots, statWeeks, teams, tradeProposals } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { attachAuditEvent, notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import { assetPlayerIds } from "@/trades/assets";
import type { ValuedPlayer } from "@/trades/fairness";
import { applyTradeInTx } from "./trade-transfer";
import { playersById, summarizeAssets } from "./trades";

const systemClock: Clock = { now: () => new Date().toISOString() };

/** No such trade for the flag's own `(tradeId, leagueId)` — defensive only. A `trade_fairness`
 *  flag's `subjectId` is always a real accepted trade's id in the SAME league it names
 *  (`raiseTradeFairnessFlag`'s own `leagueId`/`tradeId` are both required fields), so this branch
 *  is never reached through `resolveFlag`'s own wiring, the same "impossible-state guard, proved
 *  by a stub" discipline this codebase's other unreachable branches hold to. */
const TRADE_NOT_FOUND = "We couldn't find that trade.";
const ALREADY_REVERSED = "This trade has already been reversed.";
const PLAYER_MOVED_AGAIN =
  "One of these players has been traded again since. Undoing this trade would take a player off a third team, so it needs a different decision.";

export interface ReverseTradeInput {
  readonly tradeId: string;
  readonly leagueId: string;
  /** The flag whose `trade_reversed` decision ordered this — stamped onto the trade row as
   *  `reversed_by_flag_id`, the same provenance-not-foreign-key shape `member_notices.audit_
   *  event_id` already uses (a FK here would take a lock on `integrity_flags` from inside a
   *  transaction that has no business touching that table's own lock at all). */
  readonly flagId: string;
  readonly operatorUserId: string;
  /** The operator's own words — `resolveFlag`'s own `input.note`, carried through verbatim so
   *  `trade_reversed`'s notice can quote it (`quoteFor`), the same split `operator_warning`
   *  keeps. */
  readonly note: string;
  readonly clock?: Clock;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /** Defaults to the real `notifyAffectedMember`. Injectable so a test never needs a live
   *  Postgres row to exercise a failure. */
  readonly notify?: typeof notifyAffectedMember;
}

export type ReversalResult =
  | { readonly ok: true; readonly tradeId: string; readonly weekNumber: number; readonly notices: readonly MemberNotice[] }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * Put a trade back. Called from `resolveFlag`'s `trade_reversed` branch (`@/integrity-service/
 * flags`), in ITS OWN transaction — never inside `resolveFlag`'s own. `docs/decisions/operators-
 * and-moderation.md` §5's ruling ("one transaction, one chain") is why: this transaction's own
 * anchor is the LEAGUE chain (a roster_move two managers can already see), and `resolveFlag`'s is
 * the PLATFORM chain (`flag_resolved`, a record about a person under review) — the same two-class
 * split that decision already makes for every other resolution. `recordAll` throws on a batch that
 * spans scopes; two SEPARATE transactions is not a style choice around that, it is the only shape
 * that keeps each one to the chain ruling 3 allows it.
 *
 * COMMIT ORDER, STATED: this transaction commits FIRST, and `resolveFlag`'s own stamp only opens
 * once this one has succeeded. A refusal here (the world has moved on, or a race already reversed
 * this trade) therefore leaves the flag OPEN — `resolveFlag` never even begins its own
 * transaction, so there is nothing to roll back and nothing false is ever recorded. The narrower
 * risk this ordering accepts, honestly: if THIS transaction commits and `resolveFlag`'s own later
 * fails (a thrown `audit`/`notify` failure), the trade IS reversed but the flag stays open with no
 * automatic remedy — the same asymmetry `raiseTradeFairnessFlag` accepts for the opposite ordering
 * (Task 6), except here nothing is silently swallowed: the failure propagates out of `resolveFlag`
 * as a rejected promise, so an operator sees an error rather than a false "ok" for a resolution
 * that never landed. A retry of the SAME flag then meets this function's own `ALREADY_REVERSED`
 * guard and refuses cleanly — the trade is not reversed twice, but the flag needs a different
 * decision (or a fixed `flag_resolved` write) to close. Named here rather than hidden, per the
 * dispatch instruction to implement and test this failure injection directly.
 *
 * A reversal is a COMPENSATING TRANSFER, not an undo (ruling 4): it runs `applyTradeInTx` with the
 * two sides swapped — what now sits with the proposer (the counterparty's original assets) leaves
 * for the counterparty, and what now sits with the counterparty (the proposer's original assets)
 * leaves for the proposer — and stamps `reversed_at`/`reversed_by_flag_id` on the ORIGINAL row.
 * Nothing is deleted, `status` never moves off `'accepted'`, and no settled week is re-scored:
 * `applyTradeInTx` calls `materializeLockedLineupsInTx` first, exactly as it does for the original
 * trade, freezing whatever a manager actually fielded in every week that locked between accept and
 * this reversal before either roster moves again.
 *
 * It refuses rather than improvises when the world has moved on. If any traded player is no longer
 * on the roster the trade put him on, this returns a refusal (`PLAYER_MOVED_AGAIN`) that rolls the
 * whole attempt back before any write, leaving the flag open — an operator who cannot undo a trade
 * should be looking at a question they still have to answer, not at a flag stamped with a decision
 * that did not happen.
 *
 * LOCK ORDER. In order: (1) a plain read of the trade row, no write, safe to refuse from
 * (not-found / not-accepted / already-reversed); (2) `stat_weeks[weekNumber] FOR SHARE`, taken
 * FIRST among this transaction's own locks — matching `setLineup`'s and `acceptTrade`'s own
 * position — so the three roster-adjacent writers in this codebase all take the same first lock in
 * the same position, which is the property that keeps them from forming a cycle
 * (`lock-order.test.ts` drives this against a parked `persistTick`); (3) both teams' rows, `FOR
 * UPDATE`, in CANONICAL SORTED-BY-ID order — identical to `acceptTrade`'s own ruling, and for the
 * identical reason (two concurrent reversals, or a reversal racing a fresh accept, touching the
 * same two teams must converge on one order); (4) the ownership re-check, still a plain read, safe
 * to refuse from; (5) the guarded `UPDATE` (`reversed_at IS NULL`) — the one-way stamp and the
 * LAST write before the transfer, safe as a plain return since a `WHERE` matching zero rows changes
 * nothing; (6) `applyTradeInTx` and the notices, from here on either the happy path or a THROW
 * (`TransferRefusedError`, caught by `resolveFlag`'s own wrapping `try`/`catch`, mirroring
 * `acceptTrade` exactly); (7) the anchor, ONE `roster_move` on the league chain, LAST.
 */
export async function reverseTradeInTx(tx: DbTx, input: ReverseTradeInput): Promise<ReversalResult> {
  const clock = input.clock ?? systemClock;
  const audit = input.audit ?? getAuditLogger();
  const notify = input.notify ?? notifyAffectedMember;
  const now = clock.now();

  // STEP 1 — a PLAIN READ, no write. Every refusal through step 5 below can therefore return a
  // plain `{ ok: false, ... }` safely, the same discipline `acceptTrade` holds to.
  const [existing] = await tx
    .select()
    .from(tradeProposals)
    .where(and(eq(tradeProposals.id, input.tradeId), eq(tradeProposals.leagueId, input.leagueId)));
  if (existing === undefined || existing.status !== "accepted") {
    return { ok: false, status: 404, reason: TRADE_NOT_FOUND };
  }
  if (existing.reversedAt !== null) {
    return { ok: false, status: 409, reason: ALREADY_REVERSED };
  }

  // STEP 2 — the week lock, matching `setLineup`'s/`acceptTrade`'s own position: first, ahead of
  // any write in this transaction. A reversal never REFUSES on the week's own status (ruling 18 —
  // it is exactly the mechanism that lets a reversal happen after a week has locked), but it must
  // still take this lock in this position for the same cycle-avoidance reason every other
  // roster-adjacent writer in this codebase does.
  await tx.select({ status: statWeeks.status }).from(statWeeks).where(eq(statWeeks.week, existing.weekNumber)).for("share");

  // STEP 3 — both teams' rows, FOR UPDATE, canonical sorted-by-id order — identical to
  // acceptTrade's own ruling.
  const [firstTeamId, secondTeamId] = [existing.proposerTeamId, existing.counterpartyTeamId].sort();
  await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, firstTeamId)).for("update");
  await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, secondTeamId)).for("update");

  // What the trade moved: `originallyGaveIds` left the proposer and is now (ordinarily) on the
  // counterparty's roster; `originallyGotIds` left the counterparty and is now on the proposer's.
  const originallyGaveIds = assetPlayerIds(existing.proposerAssets);
  const originallyGotIds = assetPlayerIds(existing.counterpartyAssets);

  // STEP 4 — OWNERSHIP, RE-CHECKED HERE, still a plain read. The whole reason a reversal can be
  // refused: the world has moved on, and undoing this trade would take a player off a team that
  // never agreed to anything.
  const currentRosterRows = await tx
    .select({ teamId: rosterSlots.teamId, playerId: rosterSlots.playerId })
    .from(rosterSlots)
    .where(inArray(rosterSlots.teamId, [existing.proposerTeamId, existing.counterpartyTeamId]));
  const ownedByProposer = new Set(currentRosterRows.filter((r) => r.teamId === existing.proposerTeamId).map((r) => r.playerId));
  const ownedByCounterparty = new Set(currentRosterRows.filter((r) => r.teamId === existing.counterpartyTeamId).map((r) => r.playerId));
  if (!originallyGotIds.every((id) => ownedByProposer.has(id)) || !originallyGaveIds.every((id) => ownedByCounterparty.has(id))) {
    return { ok: false, status: 409, reason: PLAYER_MOVED_AGAIN };
  }

  // STEP 5 — THE GUARDED UPDATE: `reversed_at IS NULL` is the guard, not a prior read — the same
  // "judge by this write's own returned rows" discipline every stamp in this codebase uses. A
  // concurrent second reversal attempt matches zero rows here rather than double-stamping. Still
  // safe as a plain return: a `WHERE` matching zero rows changes nothing. `status` is untouched —
  // forward-only history, never a status rewind (ruling 4).
  const [row] = await tx
    .update(tradeProposals)
    .set({ reversedAt: new Date(now), reversedByFlagId: input.flagId })
    .where(and(eq(tradeProposals.id, input.tradeId), eq(tradeProposals.status, "accepted"), isNull(tradeProposals.reversedAt)))
    .returning();
  if (row === undefined) {
    return { ok: false, status: 409, reason: ALREADY_REVERSED };
  }

  // EVERYTHING FROM HERE ON is either the happy path or a THROW — `applyTradeInTx`'s own
  // `TransferRefusedError`, caught by `resolveFlag`'s own wrapping `try`/`catch` around this
  // function's transaction, mirroring `acceptTrade` exactly.
  const [leagueRow] = await tx.select({ name: leagues.name, rosterSlots: leagues.rosterSlots }).from(leagues).where(eq(leagues.id, input.leagueId));
  // FK-guaranteed: `trade_proposals.league_id` references `leagues.id`, cascading — a row this
  // transaction just guarded-updated always names a league that is still there.
  const league = leagueRow!;

  // THE COMPENSATING TRANSFER: applyTradeInTx run with the two sides swapped (ruling 4).
  // `materializeLockedLineupsInTx` runs first, inside this same call, freezing any week locked
  // between accept and now — the reversal is itself a roster mutation and would otherwise rewrite
  // history exactly the way the original trade would have.
  await applyTradeInTx(tx, {
    leagueId: input.leagueId,
    slotConfig: league.rosterSlots,
    proposerTeamId: row.proposerTeamId,
    counterpartyTeamId: row.counterpartyTeamId,
    proposerAssets: row.counterpartyAssets,
    counterpartyAssets: row.proposerAssets,
  });

  // NOTICES — trade_reversed to BOTH parties, before the anchor (ruling 3). Every other
  // resolution in this product names one person; a reversal changes two rosters, so both are told
  // the identical words (the product never signals which of the two was the one under
  // suspicion).
  const teamRows = await tx
    .select({ id: teams.id, name: teams.name, userId: teams.userId })
    .from(teams)
    .where(inArray(teams.id, [row.proposerTeamId, row.counterpartyTeamId]));
  const teamById = new Map(teamRows.map((t) => [t.id, t]));
  const proposerTeam = teamById.get(row.proposerTeamId)!;
  const counterpartyTeam = teamById.get(row.counterpartyTeamId)!;

  const movedIds = [...originallyGaveIds, ...originallyGotIds];
  const playerRows =
    movedIds.length === 0 ? [] : await tx.select({ id: players.id, name: players.name, position: players.position }).from(players).where(inArray(players.id, movedIds));
  // `averagePoints` is unused by `summarizeAssets`/`describeAsset` — stubbed at 0, the identical
  // shape `acceptTrade`'s own `movedPlayersById` uses.
  const movedPlayersById: Readonly<Record<string, ValuedPlayer>> = playersById(
    playerRows.map((p) => ({ playerId: p.id, name: p.name, position: p.position, averagePoints: 0 })),
  );

  const proposerNotice = await notify(tx, {
    leagueId: row.leagueId,
    userId: proposerTeam.userId,
    noticeType: "trade_reversed",
    context: {
      leagueName: league.name,
      counterpartyTeamName: counterpartyTeam.name,
      gotBackSummary: summarizeAssets(row.proposerAssets, movedPlayersById),
      gaveBackSummary: summarizeAssets(row.counterpartyAssets, movedPlayersById),
      note: input.note,
    },
    occurredAt: now,
    auditEventId: null,
  });
  const counterpartyNotice = await notify(tx, {
    leagueId: row.leagueId,
    userId: counterpartyTeam.userId,
    noticeType: "trade_reversed",
    context: {
      leagueName: league.name,
      counterpartyTeamName: proposerTeam.name,
      gotBackSummary: summarizeAssets(row.counterpartyAssets, movedPlayersById),
      gaveBackSummary: summarizeAssets(row.proposerAssets, movedPlayersById),
      note: input.note,
    },
    occurredAt: now,
    auditEventId: null,
  });

  // ANCHOR — LEAGUE chain, ONE `roster_move`, LAST. Never a second `trade_accepted`-shaped event:
  // a reversal is a consequence, not a second acceptance, the same "one type, `payload` tells them
  // apart" shape `trade_rejected`/`trade_withdrawn` already share (`AUDIT_EVENT_TYPES` is frozen).
  const event = await audit.record(tx, {
    eventType: "roster_move",
    actorId: input.operatorUserId,
    actorType: "user",
    leagueId: row.leagueId,
    payload: {
      reason: "trade_reversed",
      tradeId: row.id,
      flagId: input.flagId,
      proposerTeamId: row.proposerTeamId,
      counterpartyTeamId: row.counterpartyTeamId,
      proposerAssetIds: originallyGotIds,
      counterpartyAssetIds: originallyGaveIds,
    },
    occurredAt: now,
  });
  await attachAuditEvent(tx, proposerNotice, event.eventId);
  await attachAuditEvent(tx, counterpartyNotice, event.eventId);

  return { ok: true, tradeId: row.id, weekNumber: row.weekNumber, notices: [proposerNotice, counterpartyNotice] };
}
