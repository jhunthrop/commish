import { Badge, Card } from "@/components/ui";
import { plural } from "@/domain/duration";
import type { ByeStackWarning, MockHistoryInsights, MostDraftedPlayerView } from "./insights";

export interface InsightsRailProps {
  readonly mockHistory: Omit<MockHistoryInsights, "mostDrafted"> & { readonly mostDrafted: readonly MostDraftedPlayerView[] };
  readonly byeStack: ByeStackWarning | null;
  readonly entryNamesByPlayerId: ReadonlyMap<string, string>;
}

/**
 * MY SHEET'S INSIGHTS RAIL (spec §4) — "what your mocks say" and the bye-stack warning, and
 * NOTHING ELSE: every other insight the spec names (sheet health vs. winning sim shapes, a
 * NEVER-DRAFT that would have been the clear value) needs the Simulator's own output, which does
 * not exist yet in this phase. Ships empty rather than fabricated when there is nothing real to
 * show — a caller with one or zero completed mocks and no bye collision sees a plain sentence
 * saying so, never an invented pattern.
 */
export function InsightsRail({ mockHistory, byeStack, entryNamesByPlayerId }: InsightsRailProps) {
  const hasFirstTe = mockHistory.firstTeRounds !== null && mockHistory.firstTeRounds.length > 0;
  const hasMostDrafted = mockHistory.mostDrafted.length > 0;
  const hasByeStack = byeStack !== null;

  if (!hasFirstTe && !hasMostDrafted && !hasByeStack) {
    return (
      <Card className="text-sm text-text-muted">
        No insights yet. Complete a couple of mock drafts and this rail will start naming your own patterns.
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-text-primary">What your mocks say</h2>
      {hasFirstTe ? (
        <Card className="flex flex-col gap-1 text-sm">
          <span className="text-text-primary">
            {`Across ${mockHistory.mockCount} mocks, your first tight end went in round ${Math.round(
              mockHistory.firstTeRounds!.reduce((sum, round) => sum + round, 0) / mockHistory.firstTeRounds!.length,
            )} on average.`}
          </span>
        </Card>
      ) : null}
      {hasMostDrafted ? (
        <Card className="flex flex-col gap-1.5 text-sm">
          <span className="text-text-primary">Players you keep drafting</span>
          <ul className="flex flex-col gap-1">
            {mockHistory.mostDrafted.slice(0, 5).map((row) => (
              <li key={row.playerId} className="flex items-center justify-between text-text-muted">
                <span>{row.name}</span>
                <Badge tone="neutral">{plural(row.count, "mock")}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {hasByeStack ? (
        <Card className="flex flex-col gap-1 text-sm">
          <span className="text-warning">{`Bye-week ${byeStack.week}: ${byeStack.count} players near the top of your sheet share it.`}</span>
          <span className="text-text-muted">{byeStack.playerIds.map((playerId) => entryNamesByPlayerId.get(playerId) ?? playerId).join(", ")}</span>
        </Card>
      ) : null}
    </div>
  );
}
