/**
 * THE ADVISOR, WITH ITS DB READS — what the assistant route calls. `assistantCall` (`call.ts`)
 * stays the pure engine's plumbing; this is the same plumbing plus the three things a live
 * strategist adds on top of it: display names for every id the card shows, a memo of the computed
 * view per room state (the voice re-poll must never re-run the simulator for the same sequence),
 * and the writer under its budget when you are close to the clock.
 *
 * MEMBERSHIP AND SEAT, ONE CONDITION — unchanged from `call.ts`: a stranger and a commissioner
 * with no seat both read as `teamId === null`, and there is nothing to advise.
 */
import { inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { players as playersTable } from "@/db/schema";
import type { CapsuleWriterDeps } from "@/capsules/write";
import type { LeagueShape } from "@/projections/decide/replacement";
import { getDraftStore, resolveDraftActor } from "@/draft-service";
import { evidencePoolFor } from "../sim/evidence";
import { advisorCore } from "./advisor";
import { askingWindow, valuedEvidence, winningBuildsFor } from "./call";
import { ADVISOR_CONFIG } from "./config";
import type { AdvisorView } from "./view";
import { voiceWithinBudget } from "./voice/budget";
import { generateAdvisorVoice } from "./voice/generate";

export interface AdvisorServiceDeps {
  /** The gateway writer, or `null` when no key is configured: the template floor shows. */
  readonly voice: CapsuleWriterDeps | null;
  readonly now?: () => number;
}

interface MemoEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

const MAX_MEMO = 128;

/** A tiny bounded memo with a TTL — the shape `assistant-memory.ts` uses on the client. */
function memoize<T>(store: Map<string, MemoEntry<T>>, key: string, ttlMs: number, now: number, factory: () => T): T {
  const hit = store.get(key);
  if (hit !== undefined && hit.expiresAt > now) return hit.value;
  const value = factory();
  store.delete(key);
  store.set(key, { value, expiresAt: now + ttlMs });
  while (store.size > MAX_MEMO) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  return value;
}

/** Two bounded, per-instance caches BY DESIGN (the immutability rule's one sanctioned shape):
 *  `viewMemo` keeps one room state's computed advisor for `ADVISOR_CONFIG.memoTtlMs` so a voice
 *  re-poll never re-runs the simulator, `namesMemo` keeps a draft's names for its lifetime. Both
 *  evict least-recently-written past `MAX_MEMO`; a miss is a recompute, never a wrong answer. */
const viewMemo = new Map<string, MemoEntry<AdvisorView | null>>();
const namesMemo = new Map<string, MemoEntry<Promise<Readonly<Record<string, string>>>>>();

/** A draft's pool never changes, so its names are read once per draft per instance. */
function namesFor(db: Db, draftId: string, playerIds: readonly string[], now: number): Promise<Readonly<Record<string, string>>> {
  return memoize(namesMemo, draftId, ADVISOR_CONFIG.memoTtlMs * 10, now, async () => {
    if (playerIds.length === 0) return {};
    const rows = await db.select({ id: playersTable.id, name: playersTable.name }).from(playersTable).where(inArray(playersTable.id, [...playerIds]));
    return Object.fromEntries(rows.map((row) => [row.id, row.name]));
  });
}

/** Test seam only. */
export function resetAdvisorMemoForTests(): void {
  viewMemo.clear();
  namesMemo.clear();
}

/**
 * `null` when the caller has no seat to advise, the draft is not `in_progress`, or the seat has
 * no further turn — the same three answers `assistantCall` gives, for the same reasons.
 */
export async function advisorFor(db: Db, draftId: string, userId: string, deps: AdvisorServiceDeps): Promise<AdvisorView | null> {
  const now = deps.now ?? Date.now;
  const actorResult = await resolveDraftActor(db, draftId, userId);
  if (!actorResult.ok) return null;
  const { actor } = actorResult;
  const teamId = actor.teamId;
  if (teamId === null) return null;

  const state = await getDraftStore().getDraftState(draftId);
  if (state === null || state.phase !== "in_progress") return null;
  if (askingWindow(state, teamId) === null) return null;

  const key = `${draftId}:${teamId}:${state.sequence}`;
  const cached = viewMemo.get(key);
  const view =
    cached !== undefined && cached.expiresAt > now()
      ? cached.value
      : await (async () => {
          const shape: LeagueShape = { teamCount: state.draftOrder.length, rosterSlots: state.config.slotConfig };
          const { pool, boardGeneration } = await evidencePoolFor(db);
          const valued = valuedEvidence(pool, shape);
          const slot = state.draftOrder.indexOf(teamId) + 1;
          const [winningBuilds, names] = await Promise.all([
            winningBuildsFor(db, userId, actor.leagueId, shape, slot, boardGeneration),
            namesFor(db, draftId, state.pool.map((entry) => entry.playerId), now()),
          ]);
          return memoize(viewMemo, key, ADVISOR_CONFIG.memoTtlMs, now(), () =>
            advisorCore({ state, askingTeamId: teamId, valued, shape, seedNamespace: draftId, winningBuilds, computedBasis: boardGeneration, names }),
          );
        })();
  if (view === null) return null;
  return { ...view, voice: await voiceFor(key, view, deps.voice) };
}

async function voiceFor(key: string, view: AdvisorView, writer: CapsuleWriterDeps | null): Promise<AdvisorView["voice"]> {
  if (writer === null || view.picksUntilYourTurn > ADVISOR_CONFIG.voice.writeWithinPicks) return view.voice;
  return voiceWithinBudget(key, () => generateAdvisorVoice(view, writer), ADVISOR_CONFIG.voice.budgetMs);
}
