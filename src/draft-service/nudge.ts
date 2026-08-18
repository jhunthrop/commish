import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { draftNudges, teams } from "@/db/schema";
import { currentDeadline, draftClockView, nudgeDeadline, teamOnClock, type DraftState } from "@/draft-engine";
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
 * `(draftId, sequence)`, inserted with ON CONFLICT DO NOTHING … RETURNING: the writer that
 * gets a row back is the one that speaks. An in-memory set would forget across a restart and
 * would not be shared with a second instance; a committed row does neither.
 */
export function createNudgeScheduler({
  db,
  publish,
  copy,
  thresholdPct = DRAFT_NUDGE_CONFIG.thresholdPct,
  onError,
}: NudgeSchedulerDeps): NudgeScheduler {
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
        const nowMs = Date.parse(now);
        if (nowMs < Date.parse(dueAt) || nowMs >= Date.parse(deadlineAt)) return "skipped";

        const claimed = await db
          .insert(draftNudges)
          .values({ draftId, sequence: state.sequence })
          .onConflictDoNothing()
          .returning({ sequence: draftNudges.sequence });
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
