import Link from "next/link";
import { PositionBadge, StatPill } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { DRAFT_ROOM_CONFIG } from "@/draft-room/state/config";
import { bestAvailableFraction, formatPickSlot } from "@/draft-room/state/debrief";
import { fillCopyTemplate, formatGap } from "@/draft-room/state/format";
import { MOCK_COPY, type MockMode } from "@/mock-draft/config";
import type { MockDebriefHighlight, MockDebriefSummary } from "@/mock-draft-service/debrief";

/**
 * WHAT YOUR LAST MOCK SAYS (the workflow pass, law 3) — the page's second half: the most recent
 * completed mock summarized from the data the product already computes (`completedMockDebriefs`
 * walks the stored draft through the SAME `reviewPicks`/`verdict` machinery the debrief page
 * renders), then the earlier mocks as quiet rows carrying their best-available fractions.
 *
 * A SERVER COMPONENT on purpose: everything here is a fact of finished drafts, read once by the
 * page — nothing polls, nothing hydrates, and `MOCK_COPY` is read directly because this file
 * lives on the server side of the boundary (the one place that is allowed).
 *
 * A caller with no completed mocks never sees this component at all — the page self-omits the
 * column and the doors take the width (law 3's empty state: absence, not an empty panel).
 */

const MODE_LABEL: Readonly<Record<MockMode, string>> = {
  solo: "Solo",
  lobby: "Lobby",
  link: "Private link",
};

function metaLine(summary: MockDebriefSummary): string {
  const seat = summary.seat > 0 ? ` · seat ${summary.seat}` : "";
  return `${MODE_LABEL[summary.mode]} · ${summary.teamCount} teams${seat}`;
}

/** The row's verdict, as the stated fact it is — tone by the debrief's own stated thresholds,
 *  never a fresh judgment: 0 ranked higher IS best available, the reach threshold IS a reach. */
function HighlightRow({ highlight, teamCount }: { readonly highlight: MockDebriefHighlight; readonly teamCount: number }) {
  const reach = highlight.bestAvailableDelta >= DRAFT_ROOM_CONFIG.debrief.reachRankedHigher;
  return (
    <li className="flex items-center gap-2.5 rounded-md border border-line px-3 py-2">
      <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-text-muted">
        {formatPickSlot(highlight.pickNumber, teamCount)}
      </span>
      <PositionBadge position={highlight.position} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{highlight.playerName}</span>
      {highlight.bestAvailableDelta === 0 ? (
        <StatPill label={MOCK_COPY.resultsPickBestAvailable} tone="positive" />
      ) : (
        <StatPill
          label={fillCopyTemplate(MOCK_COPY.resultsPickRankedHigherAvailable, { count: String(highlight.bestAvailableDelta) })}
          tone={reach ? "negative" : "neutral"}
        />
      )}
    </li>
  );
}

function StatTile({ value, caption }: { readonly value: string; readonly caption: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md border border-line bg-surface-elevated px-3 py-2.5">
      <span className="font-display text-xl font-bold tabular-nums text-text-primary">{value}</span>
      <span className="text-xs text-text-faint">{caption}</span>
    </div>
  );
}

export function LearningColumn({ summaries }: { readonly summaries: readonly MockDebriefSummary[] }) {
  const [latest, ...earlier] = summaries;
  if (latest === undefined) return null;
  const highlights = [latest.best, latest.worstReach].filter(
    (highlight): highlight is MockDebriefHighlight => highlight !== null,
  );
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h2 className={`${MICRO_LABEL} text-text-faint`}>{MOCK_COPY.learningHeading}</h2>

      <section aria-label={MOCK_COPY.learningHeading} className="flex flex-col gap-3 rounded-lg border border-line p-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-sm font-semibold text-text-primary">{metaLine(latest)}</span>
          <span className="font-mono text-xs tabular-nums text-text-faint">{formatGap(latest.startedAgoMs)} ago</span>
          <Link href={`/app/drafts/${latest.draftId}`} className={`${MICRO_LABEL} ml-auto font-semibold text-accent hover:opacity-80`}>
            Full debrief
          </Link>
        </div>

        <div className="flex flex-wrap gap-2">
          <StatTile value={bestAvailableFraction(latest.counts)} caption={MOCK_COPY.resultsStatBestAvailableCaption} />
          <StatTile
            value={String(latest.counts.reaches)}
            caption={fillCopyTemplate(MOCK_COPY.resultsStatReachCaption, {
              threshold: String(DRAFT_ROOM_CONFIG.debrief.reachRankedHigher),
            })}
          />
          {latest.shapeLeader === null ? null : (
            <StatTile
              value={`${latest.shapeLeader.count} ${latest.shapeLeader.position}`}
              caption={fillCopyTemplate(MOCK_COPY.resultsShapeSentence, {
                count: String(latest.shapeLeader.count),
                position: latest.shapeLeader.position,
                rounds: String(DRAFT_ROOM_CONFIG.debrief.shapeRounds),
              })}
            />
          )}
        </div>

        {highlights.length === 0 ? null : (
          <ul aria-label="Notable picks" className="flex flex-col gap-1.5">
            {highlights.map((highlight) => (
              <HighlightRow key={highlight.pickNumber} highlight={highlight} teamCount={latest.teamCount} />
            ))}
          </ul>
        )}

        <p className="text-xs text-text-faint">
          {fillCopyTemplate(MOCK_COPY.learningFootnote, { count: String(latest.counts.total) })}
        </p>
      </section>

      {earlier.length === 0 ? null : (
        <>
          <h2 className={`${MICRO_LABEL} text-text-faint`}>{MOCK_COPY.earlierHeading}</h2>
          <ul aria-label={MOCK_COPY.earlierHeading} className="flex flex-col gap-1.5">
            {earlier.map((summary) => (
              <li key={summary.draftId} className="flex flex-wrap items-center gap-3 rounded-md border border-line px-3 py-2">
                <span className="text-sm font-semibold text-text-primary">{metaLine(summary)}</span>
                <span className="font-mono text-xs tabular-nums text-text-faint">{formatGap(summary.startedAgoMs)} ago</span>
                <span className="ml-auto font-mono text-xs tabular-nums text-text-muted">
                  {fillCopyTemplate(MOCK_COPY.bestFractionRow, { fraction: bestAvailableFraction(summary.counts) })}
                </span>
                <Link href={`/app/drafts/${summary.draftId}`} className={`${MICRO_LABEL} font-semibold text-accent hover:opacity-80`}>
                  Debrief
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
