import { eq } from "drizzle-orm";
import type { Db } from "@research/db/client";
import { draftNudges, teams, users } from "@/db/schema";
import { currentDeadline, draftClockView, isPaused, nudgeDeadline, teamOnClock, type DraftState } from "@/draft-engine";
import { MS_PER_SECOND } from "@/domain/duration";
import { DRAFT_NUDGE_CONFIG } from "./config";
import type { NudgeCopyFn } from "./nudge-copy";
import type { PublishFn } from "./store";

export type NudgeOutcome = "skipped" | "already-nudged" | "published";

export interface NudgeScheduler {
  /** Nudge the team on the clock if it is time and nobody has yet. Never throws. */
  nudge(state: DraftState, now: string): Promise<NudgeOutcome>;
}

export interface NudgeSchedulerDeps {
  readonly db: Db;
  readonly publish: PublishFn;
  readonly copy: NudgeCopyFn;
  /** Defaults to `DRAFT_NUDGE_CONFIG.thresholdPct` — the spec's DRAFT_NUDGE_THRESHOLD_PCT. */
  readonly thresholdPct?: number;
  readonly onError?: (error: unknown, context: { readonly draftId: string }) => void;
}

/** For callers that want a ticker without a moderator (tests, tooling). */
export const NO_OP_NUDGE_SCHEDULER: NudgeScheduler = {
  async nudge() {
    return "skipped";
  },
};

/**
 * The AI draft moderator's pacing half. It reads state and publishes; it never applies an
 * action and never touches the clock, which is exactly why the draft's mechanical outcome is
 * identical with and without it (and with and without an LLM key).
 *
 * The "have we nudged this turn already" claim is a `draft_nudges` row keyed on
 * `(draftId, pickNumber)`, inserted with ON CONFLICT DO NOTHING … RETURNING: the writer that
 * gets a row back is the one that speaks. An in-memory set would forget across a restart and
 * would not be shared with a second instance; a committed row does neither.
 *
 * The key is the PICK, not `state.sequence`: a queue edit bumps the sequence without starting a
 * new turn (that is deliberate — editing a queue must never touch anybody's clock), so a
 * sequence-keyed claim let any manager re-arm the moderator mid-turn.
 */
export function createNudgeScheduler({
  db,
  publish,
  copy,
  thresholdPct = DRAFT_NUDGE_CONFIG.thresholdPct,
  onError,
}: NudgeSchedulerDeps): NudgeScheduler {
  // Task 4's guard, cached per team: a team's owner never changes mid-draft, so one indexed
  // read per team (never per nudge check) is enough to know for the rest of this scheduler's
  // lifetime whether the moderator may ever speak to it. `MOCK_CONFIG.botDelay`'s top
  // (`@/mock-draft/config`) already keeps a bot's own pick well inside the nudge threshold, so
  // this guard is structurally moot in practice — it exists to make "the moderator never talks
  // to a bot" a FACT this scheduler enforces, not a coincidence of two configs staying in sync.
  //
  // LIFETIME (fix round, review LOW): this `Map` lives for as long as the ENCLOSING
  // `NudgeScheduler` does — in production that is the server process's own uptime, one scheduler
  // shared across EVERY draft it ever nudges, not one per draft and not one per turn. That is
  // safe, not merely convenient: a `teams` row is DELETE + INSERT across its lifetime, never
  // reassigned to a different `userId` in place (a departed team's seat is released and a new
  // team row — a new id — is what a replacement seat gets, `releaseSeat`/`joinLeagueInTx`'s own
  // shape), so a cached `isBot` answer for a given `teamId` can never go stale out from under it.
  // NO SIZE CAP: this repo's 100%-branch coverage gate (`src/draft-service/**`) makes an
  // eviction branch this suite would have to seed tens of thousands of team rows to actually
  // exercise a worse trade than the risk it guards — a `teams.id`-keyed `boolean` is a few dozen
  // bytes, so even a platform with a million historical teams keeps this Map in the low tens of
  // megabytes, well inside what one long-lived Node process already budgets for a query cache
  // this small.
  const isBotCache = new Map<string, boolean>();

  async function isBotOwned(teamId: string): Promise<boolean> {
    const cached = isBotCache.get(teamId);
    if (cached !== undefined) return cached;
    const [row] = await db.select({ isBot: users.isBot }).from(teams).innerJoin(users, eq(users.id, teams.userId)).where(eq(teams.id, teamId));
    const isBot = row?.isBot ?? false;
    isBotCache.set(teamId, isBot);
    return isBot;
  }

  return {
    async nudge(state, now) {
      const draftId = state.config.draftId;
      try {
        const teamId = teamOnClock(state);
        const dueAt = nudgeDeadline(state, thresholdPct);
        const deadlineAt = currentDeadline(state);
        // No single team on the clock (a live auction lot, or no turn running) means there is
        // nobody to prompt; past the deadline is the ticker's expiry, not the moderator's.
        if (teamId === null || dueAt === null || deadlineAt === null) return "skipped";
        // Task 4: the moderator is part of the mock showcase (ruling 11 — a first-timer stalling
        // in a mock gets the same nudge a real room gives), but it never talks to a bot, which
        // owns no inbox and reads no draft.nudge frame.
        if (await isBotOwned(teamId)) return "skipped";
        const nowMs = Date.parse(now);
        if (nowMs < Date.parse(dueAt) || nowMs >= Date.parse(deadlineAt)) return "skipped";
        // Task 4's overnight freeze. `dueAt`/`deadlineAt` are each already pushed past it
        // (`nudgeDeadline`/`currentDeadline` route through `deadlineAfter` whenever
        // `config.pauseWindow` and the current tier call for it), but the OPEN INTERVAL between
        // two extended instants still spans the freeze itself — a due time that already sits
        // exactly at the window's open never moves at all, for instance — so the range check
        // above is not sufficient on its own. `isPaused` is `selectors.ts`'s own direct answer
        // to "is right now inside the freeze": a plain selector, reading `state` and this
        // caller-supplied `now`, deciding nothing and applying no action — the reducer-purity
        // ruling (`pause.ts`'s own docblock) is about `reduce.ts`/`snake.ts`/`auction.ts`/
        // `apply-pick.ts` never reading `pauseWindow`, which this function never does either.
        if (isPaused(state, now)) return "skipped";

        const claimed = await db
          .insert(draftNudges)
          .values({ draftId, pickNumber: state.pickNumber })
          .onConflictDoNothing()
          .returning({ pickNumber: draftNudges.pickNumber });
        if (claimed.length === 0) return "already-nudged";

        const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId));
        const message = await copy({
          teamName: team?.name ?? "Your team",
          secondsRemaining: Math.ceil((Date.parse(deadlineAt) - nowMs) / MS_PER_SECOND),
          action: state.config.format === "auction" ? "nominate" : "pick",
        });

        await publish({
          leagueId: state.config.leagueId,
          type: "draft.nudge",
          payload: { draftId, clock: draftClockView(state), teamId, message },
        });
        return "published";
      } catch (error: unknown) {
        // Best-effort by contract: a moderator that cannot speak must never stop a draft.
        onError?.(error, { draftId });
        return "skipped";
      }
    },
  };
}
