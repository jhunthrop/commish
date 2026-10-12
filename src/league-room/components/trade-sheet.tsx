"use client";

import { useEffect, useState } from "react";
import { BigNumber, Button, Manager, PlayerRow } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { DecisionSheet } from "@/components/ui/decision-sheet";
import { positionStickerClass } from "@/components/ui/position-badge";
import type { Position } from "@research/domain/player";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { TradeProposalView } from "@/trades/contract";
import type { TradeAssessmentBody, TradeRoomContext } from "../contract";
import { useLeagueRoomDeps } from "../hooks/deps";
import { formatWeekdayClock } from "../lib/format";
import type { PricedAsset, TradeSheetMath } from "../lib/trade-math";
import { PlayerName } from "./player-peek";
import { TradeVerdict } from "./trade-verdict";

export interface TradeSheetProps {
  readonly leagueId: string;
  readonly trade: TradeProposalView;
  readonly context: TradeRoomContext;
  readonly math: TradeSheetMath;
  readonly onClose: () => void;
  /** COUNTER: the shell opens the trades surface, where the composer lives. */
  readonly onCounter: () => void;
  /** Called after a decision lands — the shell refreshes the server data and closes. */
  readonly onDecided: () => void;
}

type SheetAssessment =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly body: TradeAssessmentBody }
  | { readonly state: "unavailable" };

const DECIDED_COPY: Readonly<Record<string, string>> = {
  accepted: "Trade executed. Rosters update now.",
  under_review: "Accepted. The league has a review window before it executes.",
  held: "Accepted, and held for review before it executes.",
  rejected: "Declined.",
  withdrawn: "Offer withdrawn.",
};

/**
 * ONE SIDE OF THE SHEET, AS PEOPLE (P1). `PlayerRow` at research density: the face on the club's
 * ring, the name the largest thing on it, the club and the bye small beneath, and the ONE number
 * at the right — this week's real projection with its basis (P2, P11). A player the projection
 * read does not cover renders a dash and says why, never a zero.
 */
function AssetCard({
  leagueId,
  label,
  tone,
  assets,
  value,
}: {
  readonly leagueId: string;
  readonly label: string;
  readonly tone: "positive" | "negative";
  readonly assets: readonly PricedAsset[];
  readonly value: number | null;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-md bg-surface-raised p-2 shadow-raised">
      <p className={`${MICRO_LABEL} px-1 ${tone === "positive" ? "text-positive" : "text-negative"}`}>{label}</p>
      {assets.map((asset) =>
        // A position this read could not resolve is NOT guessed into a sticker: the row needs a
        // real `Position` and inventing one would print a claim the product cannot stand behind
        // (P11). That asset is a quiet line in the row's own rhythm instead.
        asset.position === null ? (
          <p key={asset.playerId} className="flex min-h-11 items-center px-2.5 text-md text-text-primary">
            {asset.name}
          </p>
        ) : (
        <PlayerRow
          key={asset.playerId}
          dense
          player={{
            id: asset.playerId,
            name: asset.name,
            position: asset.position,
            nflTeam: asset.nflTeam ?? "",
            headshotUrl: null,
            adp: null,
          }}
          name={<PlayerName leagueId={leagueId} playerId={asset.playerId} name={asset.name} className="truncate" />}
          meta={`${asset.nflTeam ?? ""}${asset.byeWeek === null ? "" : ` · bye week ${asset.byeWeek}`}`}
          figure={
            <BigNumber
              size="sm"
              value={asset.weekProjection === null ? null : asset.weekProjection.toFixed(1)}
              basis={asset.weekProjection === null ? "no projection this week" : "projected this week"}
            />
          }
        />
        ),
      )}
      {value === null ? null : (
        <p className="mt-auto px-1 pt-1.5 text-sm tabular-nums text-text-muted">{`side value ${Math.round(value)}`}</p>
      )}
    </div>
  );
}

function DepthRow({ position, before, after }: { readonly position: Position; readonly before: number; readonly after: number }) {
  const squares = (count: number, keyPrefix: string) =>
    Array.from({ length: count }, (_, index) => (
      <span key={`${keyPrefix}-${index}`} className={`h-2 w-6 rounded-sm ${positionStickerClass(position)}`} aria-hidden />
    ));
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 font-display text-sm font-semibold text-text-muted">{position}</span>
      <span className="flex gap-1">{squares(before, "before")}</span>
      <span aria-hidden className="text-text-faint">
        →
      </span>
      <span className="flex gap-1">{squares(after, "after")}</span>
      <span className="text-xs text-text-muted">
        {before === after ? `stays at ${after}` : `${before} becomes ${after}`}
      </span>
    </div>
  );
}

function byeSentence(byes: TradeSheetMath["byes"]): string {
  if (byes.gained.length > 0) {
    const weeks = byes.gained.join(" and ");
    return `Opens a new bye to cover: week ${weeks}.`;
  }
  if (byes.shared.length > 0) return "Same bye week both ways, nothing new to cover.";
  if (byes.cleared.length > 0) return `Clears a bye week off your calendar (week ${byes.cleared.join(", ")}).`;
  return "No bye weeks change hands.";
}

/**
 * THE TRADE SHEET — law 3's hardest homework, done before the sheet opens. Both sides priced
 * with this week's real projections and the platform's own side values (the same generic
 * assessment the composer uses — no law is ever named), roster depth drawn before and after,
 * byes checked against the real schedule. Three verbs, one accent: nothing commits until
 * ACCEPT.
 */
export function TradeSheet({ leagueId, trade, context, math, onClose, onCounter, onDecided }: TradeSheetProps) {
  const { fetchJson } = useLeagueRoomDeps();
  const [assessment, setAssessment] = useState<SheetAssessment>({ state: "loading" });
  const [busy, setBusy] = useState<"accept" | "reject" | "withdraw" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<string | null>(null);

  const iProposed = trade.from.teamId === context.myTeamId;
  const otherTeamId = iProposed ? trade.to.teamId : trade.from.teamId;
  const otherTeamName = iProposed ? trade.to.teamName : trade.from.teamName;
  const otherManager = context.managersByTeamId[otherTeamId];

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetchJson(`/api/leagues/${leagueId}/advisor/trade`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            weekNumber: trade.weekNumber,
            counterpartyTeamId: otherTeamId,
            give: math.send.map((asset) => asset.playerId),
            receive: math.receive.map((asset) => asset.playerId),
          }),
        });
        const body = (await response.json()) as ApiEnvelope<TradeAssessmentBody>;
        if (cancelled) return;
        setAssessment(body.ok ? { state: "ready", body: body.data } : { state: "unavailable" });
      } catch {
        if (!cancelled) setAssessment({ state: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchJson, leagueId, math.receive, math.send, otherTeamId, trade.weekNumber]);

  const decide = async (action: "accept" | "reject" | "withdraw"): Promise<void> => {
    if (busy !== null) return;
    setBusy(action);
    setError(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/trades/${trade.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await response.json()) as ApiEnvelope<{ readonly status: string }>;
      if (!body.ok) {
        setError(body.error);
        setBusy(null);
        return;
      }
      setDecided(DECIDED_COPY[body.data.status] ?? DECIDED_COPY[action === "reject" ? "rejected" : "accepted"]!);
    } catch {
      setError("The decision did not go through. Try again.");
      setBusy(null);
    }
  };

  const values =
    assessment.state === "ready"
      ? { receiving: assessment.body.receivingValue, giving: assessment.body.givingValue }
      : { receiving: null, giving: null };
  const depthPositions = [...new Set([...Object.keys(math.depthBefore), ...Object.keys(math.depthAfter)])] as Position[];

  return (
    <DecisionSheet
      open
      size="lg"
      title={iProposed ? `Your offer to ${otherTeamName}` : `${otherTeamName} offer a trade`}
      // THE OTHER PARTY, AS A PERSON (P1). The sheet's headline names the team because that is
      // what the offer is between; the meta line names the manager across the table from you,
      // with their face and the rival ring, and the clock beside them.
      meta={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {otherManager === undefined ? null : (
            <Manager size="sm" ring="rival" name={otherManager.name} avatar={otherManager.avatar} />
          )}
          <span>{`expires ${formatWeekdayClock(trade.expiresAt)}`}</span>
        </span>
      }
      onClose={onClose}
      footer={
        decided !== null ? (
          <>
            <p className="text-sm text-text-primary">{decided}</p>
            <Button variant="verb" size="sm" className="ml-auto" onClick={onDecided}>
              Done
            </Button>
          </>
        ) : iProposed ? (
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            loading={busy === "withdraw"}
            onClick={() => void decide("withdraw")}
          >
            Withdraw offer
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" loading={busy === "reject"} onClick={() => void decide("reject")}>
              Decline
            </Button>
            <Button variant="secondary" size="sm" onClick={onCounter} disabled={busy !== null}>
              Counter
            </Button>
            <Button variant="verb" size="sm" className="ml-auto" loading={busy === "accept"} onClick={() => void decide("accept")}>
              Accept trade
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <AssetCard leagueId={leagueId} label="You receive" tone="positive" assets={math.receive} value={values.receiving} />
        <AssetCard leagueId={leagueId} label="You send" tone="negative" assets={math.send} value={values.giving} />
      </div>

      {assessment.state === "ready" ? (
        <TradeVerdict
          assessment={{
            verdict: assessment.body.verdict,
            givingValue: assessment.body.givingValue,
            receivingValue: assessment.body.receivingValue,
          }}
        />
      ) : assessment.state === "loading" ? (
        <p className="text-xs text-text-faint">Valuing both sides…</p>
      ) : null}

      <div className="flex flex-col gap-2 rounded-md bg-surface-inset p-3">
        <p className={`${MICRO_LABEL} text-text-faint`}>Your roster, before and after</p>
        {depthPositions.map((position) => (
          <DepthRow
            key={position}
            position={position}
            before={math.depthBefore[position] ?? 0}
            after={math.depthAfter[position] ?? 0}
          />
        ))}
        <p className="text-xs text-text-muted">{byeSentence(math.byes)}</p>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </DecisionSheet>
  );
}
