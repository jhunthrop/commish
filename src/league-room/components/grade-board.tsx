"use client";

import { Fragment, useState } from "react";
import { Card } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { LeagueGradeRow } from "../contract";
import { ordinal } from "../lib/format";

export interface GradeBoardProps {
  readonly grades: readonly LeagueGradeRow[];
  /** The evidence board's own generation, already formatted ("August 18") — the fine print's
   *  "graded against our board of {basis}". Unused, and never read, when `grades` is empty. */
  readonly basis: string;
}

function formatValueCaptured(value: number): string {
  return value.toFixed(1);
}

/**
 * THE MORNING-AFTER GRADE BOARD (Task 10) — one row per team, the letter `gradeDraft`
 * (`@/draft-service/grades/engine`) assigned and the two numbers that back it up at a glance:
 * value captured (how much better the room's own picks were than the best still on the board at
 * each turn — `<= 0` always, `0` a perfect draft) and projected finish (rank by the best legal
 * starting lineup's projected points). A row expands to the rest of `GradeComponents` — starting
 * slots filled, bye collisions, the raw projected points — for a reader who wants the full case
 * behind the letter, not just the letter.
 *
 * Hidden entirely for an empty `grades`: `RoomData.grades`'s own docblock names both reasons it
 * can be empty (the league opted out, or the grading job simply hasn't written yet), and this
 * component treats them identically — there is nothing this board can say honestly about a draft
 * it has no rows for.
 */
export function GradeBoard({ grades, basis }: GradeBoardProps) {
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);

  if (grades.length === 0) return null;

  const sorted = [...grades].sort((a, b) => a.projectedRank - b.projectedRank);

  return (
    <Card as="section" aria-label="Draft grades" className="flex flex-col gap-3">
      <p className={`${MICRO_LABEL} text-text-faint`}>Draft grades</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Draft grades</caption>
          <thead>
            <tr className="text-left text-text-faint">
              <th scope="col" className="py-1.5 pr-3 font-normal">
                Grade
              </th>
              <th scope="col" className="py-1.5 pr-3 font-normal">
                Team
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-normal">
                Value captured
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-normal">
                Projected finish
              </th>
              <th scope="col" className="py-1.5 font-normal">
                <span className="sr-only">Components</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((grade) => {
              const expanded = expandedTeamId === grade.teamId;
              const detailId = `grade-components-${grade.teamId}`;
              return (
                <Fragment key={grade.teamId}>
                  <tr className="border-t border-line">
                    <td className="py-1.5 pr-3 font-display text-lg font-bold text-text-primary">{grade.letter}</td>
                    <td className="py-1.5 pr-3 text-text-primary">{grade.teamName}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-text-muted">{formatValueCaptured(grade.components.valueCaptured)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-text-muted">{ordinal(grade.projectedRank)}</td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={detailId}
                        onClick={() => setExpandedTeamId(expanded ? null : grade.teamId)}
                        className="text-xs text-text-faint hover:text-accent"
                      >
                        {expanded ? "Hide" : "Details"}
                        <span className="sr-only"> for {grade.teamName}</span>
                      </button>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr id={detailId}>
                      <td colSpan={5} className="pb-2">
                        <dl className="grid grid-cols-3 gap-x-4 gap-y-1 rounded-md bg-surface-inset px-3 py-2 text-xs">
                          <div className="flex flex-col">
                            <dt className="text-text-faint">Starting slots filled</dt>
                            <dd className="tabular-nums text-text-primary">
                              {grade.components.startingSlotsFilled} of {grade.components.startingSlotsTotal}
                            </dd>
                          </div>
                          <div className="flex flex-col">
                            <dt className="text-text-faint">Bye collisions</dt>
                            <dd className="tabular-nums text-text-primary">{grade.components.byeCollisions}</dd>
                          </div>
                          <div className="flex flex-col">
                            <dt className="text-text-faint">Projected points</dt>
                            <dd className="tabular-nums text-text-primary">{grade.components.projectedPoints.toFixed(1)}</dd>
                          </div>
                        </dl>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-text-faint">Graded against our board of {basis}</p>
    </Card>
  );
}
