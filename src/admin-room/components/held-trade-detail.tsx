"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, EYEBROW, PositionBadge, Sticker, Textarea } from "@/components/ui";
import { positionOnFillTextClass } from "@/components/ui/position-badge";
import { Icon } from "@/components/ui/icon";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { ActivityRow } from "@/integrity/activity-view";
import type { ResolutionDecision } from "@/integrity/flags";
import type { FlagSubjectView, HeldTradeManagerView, TradedPlayerView } from "@/integrity/queue-view";
import { useAdminRoomDeps } from "../hooks/deps";
import { ConfirmModal } from "./confirm-modal";

export type HeldTradeSubject = Extract<FlagSubjectView, { readonly kind: "held_trade" }>;

export interface HeldTradeDetailProps {
  readonly flagId: string;
  readonly subject: HeldTradeSubject;
  /** `trailFor`'s own bounded read (`@/integrity-service/flags`), rendered here rather than in
   *  the page's generic "What happened" card — Task 5's brief asks for this surface to show
   *  everything an operator needs and nothing else, in one place, not split across two cards that
   *  happen to sit on the same page. */
  readonly trail: readonly ActivityRow[];
  /**
   * `flagDetailFor`'s own offered set (`@/integrity/queue-view`), passed down rather than assumed
   * — final review F4. This surface used to render Release and Block unconditionally whenever the
   * flag was unresolved, which is the one place in the product that broke the page's standing
   * promise that an operator is never offered a decision that fails on submit: a held trade
   * superseded while its flag was still open (the crash window `closeSupersededHoldFlag`
   * documents) offered two buttons that both answered 409. When this set is empty,
   * `subject.noLongerHeldExplanation` says why, in that state's own words.
   */
  readonly decisions: readonly ResolutionDecision[];
  /** `INTEGRITY_CONFIG.moderation.noteMaxLength` — passed as a prop, never imported directly:
   *  `@/integrity` is blocked for room code (the client boundary, `eslint.config.mjs`). */
  readonly noteMaxLength: number;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** One manager's own standing — join date and platform history, beside the players changing
 *  hands. `joinedAt` reads "unknown" rather than a blank when the league chain carries no
 *  `member_joined` event for this account (`HeldTradeManagerView`'s own docblock,
 *  `@/integrity/queue-view`), the same "malformed or missing reads as absent" discipline every
 *  other evidence reader in this product holds to. */
function ManagerStanding({ teamName, manager }: { readonly teamName: string; readonly manager: HeldTradeManagerView }) {
  const seasonWord = manager.completedSeasons === 1 ? "season" : "seasons";
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium text-text-primary">{teamName}</p>
      <p className="text-xs text-text-muted">{manager.name}</p>
      <p className="text-xs text-text-muted">{manager.joinedAt === null ? "Join date unknown" : `Joined ${formatWhen(manager.joinedAt)}`}</p>
      <p className="text-xs text-text-muted">
        {manager.completedSeasons} completed {seasonWord} on Commish
      </p>
    </div>
  );
}

function TradedPlayerList({ heading, players }: { readonly heading: string; readonly players: readonly TradedPlayerView[] }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <h3 className="text-sm font-medium text-text-muted">{heading}</h3>
      {players.length === 0 ? (
        <p className="text-sm text-text-muted">Nothing named on this side.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {players.map((player) => (
            <li key={player.playerId}>
              {player.position === null ? (
                <span className="text-sm text-text-primary">{player.name}</span>
              ) : (
                <Sticker position={player.position} className="flex items-center gap-2 px-2 py-1">
                  <PositionBadge position={player.position} size="sm" />
                  <span className="min-w-0 break-words text-sm font-medium">{player.name}</span>
                  {/* Wave-1 review B1: the sticker's OWN on-fill role, at full strength — this is
                      12px AA body text (≥4.5:1 required), not a UI boundary, so it is never dimmed
                      by opacity. Set apart from the name beside it by size and weight alone
                      (`text-xs`, no `font-medium`), proven ≥4.5:1 for all six positions, both
                      themes, in `held-trade-detail.test.tsx`. */}
                  <span className={`shrink-0 text-xs ${positionOnFillTextClass(player.position)}`}>{player.averagePoints.toFixed(1)} pts/wk</span>
                </Sticker>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The operator's own surface for a held trade (Plan D, Task 5): both sides in full, the gap and
 * both side values with their basis label, the two managers' own standing, the audit trail, and
 * the two irreversible decisions — release or block — nothing else. `resolveFlag`'s own decision
 * vocabulary is generic across every subject type (`ResolutionForm` still drives every OTHER flag
 * type through it); this surface exists because a held trade is the one subject where the
 * operator's real question is not "which of several decisions" but "yes or no", and it renders
 * that question as the same two-button shape `TradeCard`'s own Accept/Decline pair already
 * established rather than a radio group with one control that happens to fit.
 *
 * An operator surface is a user-visible surface (Plan B ruling 27): it gets the full state
 * coverage, the axe pass, the keyboard walkthrough and 360px every other room surface does.
 */
export function HeldTradeDetail({ flagId, subject, trail, decisions, noteMaxLength }: HeldTradeDetailProps) {
  const { fetchJson } = useAdminRoomDeps();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<"trade_released" | "trade_blocked" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ResolutionDecision | null>(null);

  const submit = async (decision: "trade_released" | "trade_blocked"): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/admin/flags/${flagId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const envelope = (await response.json()) as ApiEnvelope<{ readonly flagId: string; readonly decision: ResolutionDecision }>;
      if (!envelope.ok) {
        setError(envelope.error);
        setConfirming(null);
        return;
      }
      setDone(decision);
      setConfirming(null);
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setConfirming(null);
    } finally {
      setSubmitting(false);
    }
  };

  if (done !== null) {
    return (
      <p role="status" className="text-sm text-positive">
        {done === "trade_released" ? "Released. The trade went through." : "Blocked. The trade will not go through."} This cannot be changed here. A
        different decision is a new flag.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <p className={`${EYEBROW} text-text-muted`}>The trade</p>
        <p className="mt-1 text-sm text-text-muted">{subject.valuationBasis}</p>
        <p className="mt-1 text-sm text-text-primary">{subject.fairnessGapSummary}</p>

        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ManagerStanding teamName={subject.proposerTeamName} manager={subject.proposerManager} />
          <ManagerStanding teamName={subject.counterpartyTeamName} manager={subject.counterpartyManager} />
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <TradedPlayerList heading={`${subject.proposerTeamName} sends`} players={subject.gave} />
          <TradedPlayerList heading={`${subject.counterpartyTeamName} sends`} players={subject.got} />
        </div>
      </Card>

      <Card>
        <p className={`${EYEBROW} text-text-muted`}>What happened</p>
        {trail.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">No recorded history for this flag yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col" aria-label="Held trade history">
            {trail.map((row) => (
              <li key={row.eventId} className="flex items-start gap-3 border-b border-line py-3 last:border-b-0">
                <Icon name={row.icon} size={18} className="mt-0.5 shrink-0 text-text-muted" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="break-words text-sm text-text-primary">{row.headline}</p>
                  <time dateTime={row.occurredAt} className="text-xs text-text-muted">
                    {formatWhen(row.occurredAt)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {decisions.length === 0 ? (
        <Card>
          <p className={`mb-3 ${EYEBROW} text-text-muted`}>Decision</p>
          {/* F4: no decision can land on this trade any more, so none is offered and the state
              explains itself. The flag stays OPEN on purpose — closing it is the sweep's job
              (`sweepSupersededHoldFlags`), not a button this page could invent. */}
          <p role="status" className="text-sm text-text-primary">
            {subject.noLongerHeldExplanation}
          </p>
        </Card>
      ) : (
      <Card>
        <p className={`mb-3 ${EYEBROW} text-text-muted`}>Decision</p>
        <Textarea
          label="Your note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={noteMaxLength}
          hint="Read by both managers if you block this trade. Kept on the record either way."
        />
        <p className="mt-3 text-xs text-text-muted">This cannot be taken back. A corrected decision is a new flag, not an edit.</p>

        {error === null ? null : (
          <p role="alert" className="mt-2 text-sm text-negative">
            {error}
          </p>
        )}

        {/* `gap-4`, matching `TradeCard`'s own Accept/Decline row — the only other irreversible
            button pair in this product. Wave-1 review Q8: while `ConfirmModal` is open, its OWN
            confirm button is the view's one ink action (`ConfirmModal`'s own docblock, Sunday
            Standard rule 5) — both triggers step down to the quiet pill for as long as it is,
            and step back to their ordinary color the moment it closes. */}
        <div className="mt-4 flex flex-wrap gap-4">
          {decisions.includes("trade_released") ? (
            <Button variant={confirming === null ? "primary" : "secondary"} onClick={() => setConfirming("trade_released")} disabled={submitting}>
              Release the trade
            </Button>
          ) : null}
          {decisions.includes("trade_blocked") ? (
            <Button variant={confirming === null ? "destructive" : "secondary"} onClick={() => setConfirming("trade_blocked")} disabled={submitting}>
              Block the trade
            </Button>
          ) : null}
        </div>
      </Card>
      )}

      <ConfirmModal
        open={confirming === "trade_released"}
        title="Release this trade?"
        body={<p>The trade goes through exactly as the two managers agreed to it. Both rosters change immediately. This cannot be undone.</p>}
        confirmLabel="Release the trade"
        variant="primary"
        busy={submitting}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void submit("trade_released")}
      />
      <ConfirmModal
        open={confirming === "trade_blocked"}
        title="Block this trade?"
        body={<p>The trade never goes through. Both rosters stay exactly as they were. This cannot be undone.</p>}
        confirmLabel="Block the trade"
        variant="destructive"
        busy={submitting}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void submit("trade_blocked")}
      />
    </div>
  );
}
