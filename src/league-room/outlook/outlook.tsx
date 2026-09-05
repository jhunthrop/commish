"use client";

import { useState } from "react";
import { Badge, ReasonChip } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { Position } from "@/domain/player";
import type { Law } from "@/projections/laws/types";
import type { BoardReason } from "@/projections/preseason/board";
import { groupReasons, lawGroupLabel, type EvidenceGroup } from "./groups";
import { verdictLine } from "./verdict";

/**
 * THE OUTLOOK, REDESIGNED (founder, 2026-09-04) — "a timing tower, not a spreadsheet." The old
 * section rendered `body.reasons.map(reason => <ReasonChip .../>)` directly: every fired law its
 * own chip, unordered, no verdict. This component is the one place both consumers (`PlayerPeekHost`
 * and the full player page) build the Outlook now, so the redesign lives once rather than twice.
 *
 * VERDICT FIRST, THEN THE GROUPED EVIDENCE (`./groups.ts`), ordered strongest first. `capped` is the
 * bottom-sheet's own constraint — a peek is a drawer over a live surface and does not get to grow
 * without bound — and shows the first five groups with a "The full case (N)" expander; the full
 * page passes nothing (shows every group at once, the same "no scrolling drawer to fight" the rest
 * of that page already gives a reader).
 */

const PEEK_GROUP_CAP = 5;

export interface OutlookProps {
  readonly reasons: readonly BoardReason[];
  readonly laws: readonly Law[];
  readonly position: Position;
  /** `true` for the bottom-sheet peek's own cap; `false` (the default) for the full page's
   *  "show everything" posture. */
  readonly capped?: boolean;
}

export function Outlook({ reasons, laws, position, capped = false }: OutlookProps) {
  const [showFullCase, setShowFullCase] = useState(false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());

  if (reasons.length === 0) return null;

  const groups = groupReasons(reasons, laws);
  const verdict = verdictLine(reasons, position);
  const visible = capped && !showFullCase ? groups.slice(0, PEEK_GROUP_CAP) : groups;
  const hiddenCount = groups.length - visible.length;

  const toggleGroup = (key: string) => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className={`${MICRO_LABEL} text-text-faint`}>Outlook</h3>
      {verdict === null ? null : <p className="text-sm text-text-primary">{verdict}</p>}
      <div className="flex flex-col gap-1.5">
        {visible.map((group) => (
          <EvidenceGroupRow key={group.key} group={group} laws={laws} open={openGroups.has(group.key)} onToggle={() => toggleGroup(group.key)} />
        ))}
      </div>
      {hiddenCount <= 0 ? null : (
        <button
          type="button"
          onClick={() => setShowFullCase(true)}
          aria-expanded={showFullCase}
          className={`${MICRO_LABEL} w-fit text-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
        >
          {`The full case (${groups.length})`}
        </button>
      )}
    </div>
  );
}

/** One group, one row: a non-law fact renders through the same `ReasonChip` a flat list always
 *  used; a law group leads with its net effect and the quantity phrase, presses open to show its
 *  own member laws as the receipts (each one, headline and effect, through `ReasonChip`'s own
 *  full, non-compact rendering — the same sentence a flat list already used, one per member —
 *  nothing here re-derives a law's own copy). */
function EvidenceGroupRow({ group, laws, open, onToggle }: { readonly group: EvidenceGroup; readonly laws: readonly Law[]; readonly open: boolean; readonly onToggle: () => void }) {
  if (group.kind === "fact") {
    return <ReasonChip reason={group.reason} registry={laws} className="w-fit" />;
  }

  // MEDIUM 2 (fix round 1): a bare "-1.8 pts, Age 29 season · 2 laws" reads as ONE measured
  // number, not a sum of two. "together" (`lawGroupLabel`, `./groups.ts`) makes the aggregate
  // self-evident in the copy itself for N > 1; a single-law group carries no such ambiguity and
  // keeps the plain form.
  const label = lawGroupLabel(group);

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-fit text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <Badge tone="neutral" className="max-w-full cursor-pointer truncate">
          {label}
        </Badge>
      </button>
      {!open ? null : (
        <div className="flex flex-col gap-1.5 border-l border-line pl-3">
          {group.members.map((member) => (
            <ReasonChip key={member.lawId} reason={member} registry={laws} className="w-fit" />
          ))}
        </div>
      )}
    </div>
  );
}
