import type { Db } from "@research-ts/db/client";
import { completedMockDebriefs, completedMockRoomsQuery, habitFactsOf, mockDebriefDeps } from "@/mock-draft-service/debrief";
import { mockHabits } from "@/draft-room/state/debrief";
import { byeWeeksByTeam } from "@research-ts/reference/nfl-schedule";

/**
 * MY SHEET'S INTELLIGENCE (spec §4) — "what your mocks say" and the bye-stack warning, both
 * computed from data this product already has and nothing else. No insight ships until its own
 * real data exists: a first-TE-round pattern needs at least two completed mocks
 * (`mockHabits`'s own refusal below two), and a most-drafted list needs at least one pick ever
 * actually made.
 */
export interface MostDraftedPlayer {
  readonly playerId: string;
  /** How many of the caller's own completed mocks landed him on their team. */
  readonly count: number;
}

/** `MostDraftedPlayer` plus his real name — what the server page hydrates before handing
 *  insights to the client, since the service layer itself has no reason to join to `players`. */
export interface MostDraftedPlayerView extends MostDraftedPlayer {
  readonly name: string;
}

export interface MockHistoryInsights {
  /** `null` when fewer than two completed mocks exist — `mockHabits`'s own threshold, the one
   *  this insight borrows rather than inventing a second one. */
  readonly firstTeRounds: readonly number[] | null;
  readonly mockCount: number;
  /** Players the caller drafted in more than one completed mock, most-drafted first — real
   *  repetition, not a single mock's own roster. Empty when nothing repeats. */
  readonly mostDrafted: readonly MostDraftedPlayer[];
}

const REPEAT_THRESHOLD = 2;

/** "What your mocks say" (spec §4) — real patterns from the caller's own completed mock history,
 *  nothing computed from a population of one. */
export async function mockHistoryInsights(db: Db, userId: string): Promise<MockHistoryInsights> {
  const rooms = await completedMockRoomsQuery(db, userId);
  const deps = mockDebriefDeps(db);

  const counts = new Map<string, number>();
  const facts = (await completedMockDebriefs(db, userId, deps)).map(habitFactsOf);

  for (const room of rooms) {
    const view = await deps.loadView(room.draftId);
    if (view === null) continue;
    for (const pick of view.picks) {
      if (pick.teamId !== room.teamId) continue;
      counts.set(pick.playerId, (counts.get(pick.playerId) ?? 0) + 1);
    }
  }

  const mostDrafted = [...counts.entries()]
    .filter(([, count]) => count >= REPEAT_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .map(([playerId, count]) => ({ playerId, count }));

  const habits = mockHabits(facts);
  return { firstTeRounds: habits?.firstTeRounds ?? null, mockCount: facts.length, mostDrafted };
}

export interface ByeStackWarning {
  readonly week: number;
  readonly count: number;
  readonly playerIds: readonly string[];
}

/**
 * A real bye-week collision among a sheet's own top entries: three or more players sharing the
 * same bye week is a real roster problem a manager is about to walk into, not a threshold picked
 * for effect — it is the smallest count that survives a normal bye-week distribution (three or
 * more teams rarely share a bye) without flagging ordinary two-player noise every sheet would
 * trip. `topN` bounds the check to the sheet's own likely-drafted range rather than its whole
 * depth chart.
 */
const BYE_STACK_THRESHOLD = 3;

export async function byeStackWarning(
  db: Db,
  entries: readonly { readonly playerId: string; readonly team: string }[],
  topN: number = 40,
): Promise<ByeStackWarning | null> {
  const byes = await byeWeeksByTeam(db);
  const byWeek = new Map<number, string[]>();
  for (const entry of entries.slice(0, topN)) {
    const week = byes.get(entry.team);
    if (week === undefined) continue;
    const list = byWeek.get(week) ?? [];
    list.push(entry.playerId);
    byWeek.set(week, list);
  }
  let worst: ByeStackWarning | null = null;
  for (const [week, playerIds] of byWeek) {
    if (playerIds.length < BYE_STACK_THRESHOLD) continue;
    if (worst === null || playerIds.length > worst.count) worst = { week, count: playerIds.length, playerIds };
  }
  return worst;
}
