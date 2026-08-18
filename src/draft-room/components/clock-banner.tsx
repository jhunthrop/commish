"use client";

import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { Badge, Card } from "@/components/ui";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { formatClockLength, formatCountdown, formatTightening } from "../state/format";
import { useNow } from "../hooks/use-now";
import { teamsById } from "../lib/lookups";

export interface ClockBannerProps {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
}

/**
 * Whose turn it is, how long is left, and — the part that turns the auto-tightening schedule
 * from an engine feature into a product feature — when the clock next shortens.
 *
 * The ticking digits are `aria-hidden`: a number changing every second inside a live region
 * is unusable with a screen reader. The sentence beneath them says the same thing statically.
 */
export function ClockBanner({ view, teams, myTeamId }: ClockBannerProps) {
  const now = useNow(DRAFT_ROOM_CONFIG.countdownTickMs);

  if (view.phase === "scheduled") {
    return (
      <Card as="section">
        <p className="text-md text-text-primary">This draft hasn&apos;t started yet.</p>
        <p className="text-sm text-text-muted">Your commissioner starts it when everyone is here.</p>
      </Card>
    );
  }
  if (view.phase === "complete") {
    return (
      <Card as="section">
        <p className="text-md text-text-primary">This draft is complete.</p>
        <p className="text-sm text-text-muted">Every roster below is final.</p>
      </Card>
    );
  }

  const byId = teamsById(teams);
  const onClockTeam = view.onClockTeamId === null ? null : (byId.get(view.onClockTeamId) ?? null);
  const isMine = view.onClockTeamId !== null && view.onClockTeamId === myTeamId;
  const remainingMs = view.deadlineAt === null ? null : Date.parse(view.deadlineAt) - now;
  const clockLength = view.clockSeconds === null ? null : formatClockLength(view.clockSeconds);
  const tightening = formatTightening(view.nextTightening, now);
  const who = onClockTeam?.name ?? "Nobody";

  return (
    <Card as="section" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={isMine ? "accent" : "neutral"}>{isMine ? "You're on the clock" : "On the clock"}</Badge>
        <span className="text-xl font-semibold text-text-primary">{who}</span>
        {remainingMs === null ? null : (
          <span data-testid="countdown" aria-hidden="true" className="ml-auto text-2xl font-semibold tabular-nums text-text-primary">
            {formatCountdown(remainingMs)}
          </span>
        )}
      </div>
      <p className="text-sm text-text-muted">
        {who} is on the clock.{clockLength === null ? "" : ` This round's pick clock is ${clockLength}.`}
      </p>
      {tightening === null ? null : <p className="text-sm text-warning">{tightening}</p>}
    </Card>
  );
}
