"use client";

import { Input, Panel, SeatMeter } from "@/components/ui";
import { Countdown, useCountdown } from "@/components/ui/countdown";

export interface ShareLinkPanelProps {
  /** The absolute URL — `MockShareInfo.url` (link audit, 2026-09-04): this panel used to show
   *  the bare `path`, the exact C-01 defect the invite panel fixed on 2026-08-27 — a member
   *  texted their crew `/app/draft/mock-drafts/ABC123`, a string that opens nothing. */
  readonly url: string;
  readonly shareCode: string;
  readonly seatsFilled: number;
  readonly seatsTotal: number;
  /** ISO instant the fill window fires. */
  readonly startsAt: string;
}

/**
 * The `link`-mode waiting surface (Task 8, Step 3): the share code as a copyable URL — the same
 * read-only-`Input` idiom `InvitePanel` (`@/league-room/components/invite-panel`) already uses
 * for a real league's own invite link, so a member can select and copy it with the keyboard on
 * every platform rather than this depending on a clipboard permission — seat fill through the
 * EXISTING `SeatMeter` primitive (centralize-the-first-time: reuse it, never a second meter),
 * and the countdown to the fill window's own `startsAt`.
 *
 * `DraftRoom` mounts this only for an unstarted `link`-mode mock (`room.mock?.share`); a solo or
 * lobby room, or a started draft, never reaches this component at all.
 */
export function ShareLinkPanel({ url, shareCode, seatsFilled, seatsTotal, startsAt }: ShareLinkPanelProps) {
  const { remainingMs } = useCountdown(startsAt);
  return (
    <div className="mx-4 mt-3" data-testid="share-link-panel">
      <Panel title="Invite others to this mock draft">
        <div className="flex flex-col gap-3">
          <Input label="Share link" value={url} readOnly />
          <p className="text-sm text-text-muted">
            Or share the code <span className="font-mono font-semibold text-text-primary">{shareCode}</span>.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <SeatMeter filled={seatsFilled} total={seatsTotal} />
            {remainingMs === null ? null : <Countdown remainingMs={remainingMs} size="sm" data-testid="share-link-countdown" />}
          </div>
        </div>
      </Panel>
    </div>
  );
}
