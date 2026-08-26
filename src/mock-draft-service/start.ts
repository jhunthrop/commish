import { eq } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { drafts, leagues, mockRooms, teams } from "@/db/schema";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { rngFor, seededShuffle } from "@/mock-draft/rng";
import { MOCK_REFUSALS, type MockLifecycleDeps } from "./claim";

/**
 * The bot-seat draw's own stream key — load-bearing for replay the same way
 * `MOCK_CONFIG.botRoster` ids and the archetype deal's `"archetypes"` key are: renaming it
 * re-deals which bots every in-flight seeded room would seat on its next top-up.
 */
const BOT_SEAT_STREAM_KEY = "bot_seats";

/** One drawn seat: which roster bot, seated under its own name. */
export interface BotSeat {
  readonly id: string;
  readonly name: string;
}

/**
 * The seeded seat draw both bot-seating moments share (solo creation and the start's top-up):
 * one `seededShuffle` of the whole roster under `rngFor(botSeed, "bot_seats")`, minus whoever is
 * already seated, first `needed` taken. Pure, so the property that makes the crash-window test
 * honest is arithmetic: with the same stored seed, a retry that finds two bots already seated
 * draws exactly the bots the crashed attempt WOULD have drawn next — the deck order never moves,
 * only the cursor does.
 */
export function drawBotSeats(botSeed: number, seatedUserIds: readonly string[], needed: number): readonly BotSeat[] {
  const seated = new Set(seatedUserIds);
  const deck = seededShuffle(MOCK_CONFIG.botRoster, rngFor(botSeed, BOT_SEAT_STREAM_KEY));
  return deck.filter((bot) => !seated.has(bot.id)).slice(0, needed);
}

/**
 * Seats `teamCount - seated` roster bots inside the CALLER's transaction — `createMockRoom`'s
 * solo fill runs it in the creation transaction itself, `topUpBots` (below) under its own
 * `leagues FOR UPDATE`. Idempotent by arithmetic: seats needed is a count, not a memory, so a
 * second call against a full room inserts nothing. The bots' `users` rows exist because
 * `createMockRoom` runs `ensureMockBotRoster` before any room can exist to top up.
 *
 * Throws — rather than quietly seating a short room — if the roster cannot cover the empty
 * seats: `MOCK_CONFIG.botRoster` (24) exceeds the widest offered room (12) by design
 * (`config.test.ts` gates the margin), so this is a caller bug worth a rolled-back transaction,
 * never a state to continue from.
 */
export async function seatBotsInTx(
  tx: DbTx,
  input: { readonly leagueId: string; readonly teamCount: number; readonly botSeed: number; readonly newId: () => string },
): Promise<number> {
  const seatedRows = await tx.select({ userId: teams.userId }).from(teams).where(eq(teams.leagueId, input.leagueId));
  const needed = input.teamCount - seatedRows.length;
  if (needed <= 0) return 0;
  const bots = drawBotSeats(input.botSeed, seatedRows.map((row) => row.userId), needed);
  if (bots.length < needed) {
    throw new Error(`seatBotsInTx: the bot roster (${MOCK_CONFIG.botRoster.length}) cannot fill ${needed} empty seats in league "${input.leagueId}".`);
  }
  await tx.insert(teams).values(bots.map((bot) => ({ id: input.newId(), leagueId: input.leagueId, userId: bot.id, name: bot.name })));
  return bots.length;
}

export type TopUpBotsOutcome = { readonly ok: true; readonly added: number } | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * Fills every empty seat with a bot, in its own transaction: `leagues[X] FOR UPDATE` first (the
 * lock law — a concurrent `claimMockSeat` on the same room queues behind this, or this behind
 * it, never a cycle: both take the identical single lock as their first locking statement, and
 * everything after it in both is reads plus FK `KEY SHARE`s on rows already held or never
 * `FOR UPDATE`-locked). The `mock_rooms` read is the structural guard: NO row, NO bots — a real
 * league reached by mistake refuses (`MOCK_REFUSALS.notMock`) before a single bot is drawn,
 * the write-side twin of `joinLeagueInTx`'s bot-account refusal.
 *
 * A SEPARATE transaction from `startMockDraft`'s start on purpose: the crash window between the
 * two is closed by the ticker's retry, exactly `claimAutoStart`'s own philosophy — `drafts.
 * status` never lies, so the due scan (Task 6) always finds unfinished work, and this function's
 * count-based arithmetic makes the retry free. No audit, no notice, no money (ruling 2): the
 * anchor law is satisfied vacuously, as `claimMockSeatInTx`'s docblock argues in full.
 */
export async function topUpBots(db: Db, leagueId: string, deps: Pick<MockLifecycleDeps, "newId">): Promise<TopUpBotsOutcome> {
  return db.transaction(async (tx) => {
    const [league] = await tx.select({ teamCount: leagues.teamCount }).from(leagues).where(eq(leagues.id, leagueId)).for("update");
    if (league === undefined) return { ok: false as const, status: 404, reason: MOCK_REFUSALS.missing };
    const [room] = await tx.select({ botSeed: mockRooms.botSeed }).from(mockRooms).where(eq(mockRooms.leagueId, leagueId));
    if (room === undefined) return { ok: false as const, status: 409, reason: MOCK_REFUSALS.notMock };
    const added = await seatBotsInTx(tx, { leagueId, teamCount: league.teamCount, botSeed: room.botSeed, newId: deps.newId });
    return { ok: true as const, added };
  });
}

export type StartMockDraftOutcome = { readonly ok: true; readonly draftId: string } | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * THE one callable every start path shares: solo creation calls it the moment its transaction
 * commits, and the ticker's due scan (Task 6) calls it for a lobby/link room whose window fired
 * — full-by-humans (the early grace stamp) and countdown-expiry alike, so "how a mock starts"
 * exists exactly once.
 *
 * Top-up first, then the REAL start path: `store.startDraft` is the same thunk a real league's
 * start runs — the order draw over human and bot seats alike, the pool snapshotted from the real
 * `buildDraftPool` (mocks rank off the same ADP-backed pool a real board shows), `claimAutoStart`
 * guarding the status transition — with the store's own `isMock` lane (Task 4) silencing the
 * consequences. Called WITHOUT `auto`, deliberately: the `auto` announcement path is a real
 * league's courtesy, and the manual-press short-room guard it would otherwise imply is scoped to
 * public matchmade member leagues, which a mock structurally is not (`leagues_mock_private_ck`).
 * The bots' archetypes need no assignment step here — `assignArchetypes` (`@/mock-draft`) is a
 * pure deal off the stored `botSeed` and the bot team ids, so Task 6's driver re-derives the
 * identical deal on every tick instead of this function persisting one.
 */
export async function startMockDraft(db: Db, leagueId: string, deps: Pick<MockLifecycleDeps, "store" | "newId">): Promise<StartMockDraftOutcome> {
  const topped = await topUpBots(db, leagueId, deps);
  if (!topped.ok) return topped;
  const [draft] = await db.select({ id: drafts.id }).from(drafts).where(eq(drafts.leagueId, leagueId));
  if (draft === undefined) return { ok: false, status: 404, reason: MOCK_REFUSALS.missing };
  const started = await deps.store.startDraft(draft.id);
  if (!started.ok) return { ok: false, status: 409, reason: started.reason };
  return { ok: true, draftId: draft.id };
}
