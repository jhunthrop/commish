import { Badge, Card } from "@/components/ui";
import { plural } from "@/domain/duration";
import type { ByeStackWarning, MockHistoryInsights, MostDraftedPlayerView } from "./insights";
import type { SheetHealthReport } from "./health";

const BUILD_LABEL_TEXT: Readonly<Record<string, string>> = {
  "hero-RB": "Hero-RB",
  "zero-RB": "Zero-RB",
  "robust-RB": "Robust RB",
  "early-TE": "Early TE",
  "late-QB": "Late QB",
};

export interface InsightsRailProps {
  readonly mockHistory: Omit<MockHistoryInsights, "mostDrafted"> & { readonly mostDrafted: readonly MostDraftedPlayerView[] };
  readonly byeStack: ByeStackWarning | null;
  readonly entryNamesByPlayerId: ReadonlyMap<string, string>;
  /** Task 5's own unblocking — sheet health vs. the winning sim shapes and the NEVER-DRAFT cost
   *  flag (spec §4). `null` when no evidence board exists yet to sim against, never a fabricated
   *  report. */
  readonly sheetHealth: SheetHealthReport | null;
}

/**
 * MY SHEET'S INSIGHTS RAIL (spec §4) — "what your mocks say", the bye-stack warning, and (Task 5)
 * sheet health against the Simulator's own real output. Ships empty rather than fabricated when
 * there is nothing real to show — a caller with one or zero completed mocks and no bye collision
 * and no sim available sees a plain sentence saying so, never an invented pattern.
 */
export function InsightsRail({ mockHistory, byeStack, entryNamesByPlayerId, sheetHealth }: InsightsRailProps) {
  const hasFirstTe = mockHistory.firstTeRounds !== null && mockHistory.firstTeRounds.length > 0;
  const hasMostDrafted = mockHistory.mostDrafted.length > 0;
  const hasByeStack = byeStack !== null;
  const hasBuildComparisons = sheetHealth !== null && sheetHealth.comparisons.length > 0;
  const hasNeverFlags = sheetHealth !== null && sheetHealth.neverDraftFlags.length > 0;

  if (!hasFirstTe && !hasMostDrafted && !hasByeStack && !hasBuildComparisons && !hasNeverFlags) {
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
      {hasBuildComparisons ? (
        <Card className="flex flex-col gap-1.5 text-sm">
          <span className="text-text-primary">{"Your sheet's own shape"}</span>
          {sheetHealth!.comparisons.map((comparison) => (
            <span key={comparison.label} className="text-text-muted">
              {`${BUILD_LABEL_TEXT[comparison.label] ?? comparison.label}: ${comparison.sentence}`}
            </span>
          ))}
        </Card>
      ) : null}
      {hasNeverFlags ? (
        <Card className="flex flex-col gap-1.5 text-sm">
          <span className="text-warning">Never-draft cost</span>
          {sheetHealth!.neverDraftFlags.map((flag) => (
            <span key={flag.playerId} className="text-text-muted">
              {`${flag.name} is marked never draft, but the evidence board ranks him ${flag.boardRank} overall, inside your realistic early range.`}
            </span>
          ))}
        </Card>
      ) : null}
    </div>
  );
}
