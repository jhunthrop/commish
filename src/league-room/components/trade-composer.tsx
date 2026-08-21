"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, ErrorState, PositionBadge, Select, Sticker, Textarea } from "@/components/ui";
import type { ProposeTradeBody } from "@/trades/contract";
import { TRADE_CONFIG } from "@/trades/config";
import type { TradeRoomContext, TradeRosterPlayer } from "../contract";
import type { ProposedTrade, TradeActionResult } from "../hooks/use-trades";
import type { TradeAssessmentBody } from "../contract";
import { formatExpiry } from "../lib/format";
import { TradeVerdict, type TradeAssessmentSummary } from "./trade-verdict";

/** The full window a fresh offer stands for, in days — `TRADE_CONFIG.proposalTtlHours` read as a
 *  value (`src/trades` is client-boundary exempt), never a hardcoded "three" (fix round 1, F2). */
const PROPOSAL_TTL_DAYS = Math.round(TRADE_CONFIG.proposalTtlHours / 24);

export interface TradeComposerProps {
  readonly context: TradeRoomContext;
  readonly onAssess: (input: { weekNumber: number; counterpartyTeamId: string; give: readonly string[]; receive: readonly string[] }) => Promise<TradeActionResult<TradeAssessmentBody>>;
  readonly onPropose: (input: ProposeTradeBody) => Promise<TradeActionResult<ProposedTrade>>;
  /** The offer sent, and the sender's own propose-time advisory read on it — shown once, here,
   *  because `proposeTrade` never stores it and never shows it to the counterparty (`@/league-service
   *  /trades`'s own docblock). This is the one place a proposer sees it again after sending. */
  readonly onDone: () => void;
  readonly onCancel: () => void;
}

function togglePlayer(selected: readonly string[], playerId: string, max: number): readonly string[] {
  if (selected.includes(playerId)) return selected.filter((id) => id !== playerId);
  if (selected.length >= max) return selected;
  return [...selected, playerId];
}

function PlayerPicker({
  legend,
  roster,
  selected,
  onToggle,
}: {
  readonly legend: string;
  readonly roster: readonly TradeRosterPlayer[];
  readonly selected: readonly string[];
  readonly onToggle: (playerId: string) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-1 flex-col gap-2">
      <legend className="text-sm font-medium text-text-primary">{legend}</legend>
      {roster.length === 0 ? (
        // Fix round 1, F6 (LOW): a bare "nobody available" used to give no cause and no way
        // forward — the one empty state in this room that read as a dead end. This is a bye
        // week or a week whose matchups aren't generated yet, so the cause is named and the
        // manager is pointed at what actually resolves it, rather than left to guess.
        <p className="text-sm text-text-muted">
          Nobody available to trade for on this team right now. This usually means the week&apos;s matchups aren&apos;t set yet. Check back once
          they are, or ask your commissioner.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {roster.map((player) => {
            const checked = selected.includes(player.playerId);
            const atCap = !checked && selected.length >= TRADE_CONFIG.maxAssetsPerSide;
            return (
              <li key={player.playerId}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={atCap}
                    onChange={() => onToggle(player.playerId)}
                    className="size-4 accent-accent"
                  />
                  <Sticker position={player.position} className="flex items-center gap-2 px-2 py-1">
                    <PositionBadge position={player.position} size="sm" />
                    <span className="text-sm font-medium">{player.name}</span>
                  </Sticker>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}

/**
 * Pick a counterparty, pick a player from each roster, read the platform's own advisory read on
 * it, then send. The verdict is asked for and shown BEFORE the send control is reachable —
 * choosing at least one player on each side calls `POST /api/leagues/[leagueId]/advisor/trade`
 * (`onAssess`) and renders `TradeVerdict`, so a manager never sends an offer blind. Sending
 * itself never depends on the verdict resolving, let alone on what it says: the advisor writes
 * prose about a decision `tradeBalance` already made, and a human still clicks Send.
 */
export function TradeComposer({ context, onAssess, onPropose, onDone, onCancel }: TradeComposerProps) {
  const [counterpartyTeamId, setCounterpartyTeamId] = useState("");
  const [give, setGive] = useState<readonly string[]>([]);
  const [receive, setReceive] = useState<readonly string[]>([]);
  const [note, setNote] = useState("");
  const [assessment, setAssessment] = useState<TradeAssessmentSummary | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<TradeAssessmentSummary | null>(null);
  const assessGeneration = useRef(0);

  const myRoster = context.rostersByTeamId[context.myTeamId] ?? [];
  const theirRoster = counterpartyTeamId === "" ? [] : (context.rostersByTeamId[counterpartyTeamId] ?? []);

  useEffect(() => {
    if (counterpartyTeamId === "" || give.length === 0 || receive.length === 0) {
      setAssessment(null);
      return;
    }
    const generation = ++assessGeneration.current;
    setAssessing(true);
    void onAssess({ weekNumber: context.weekNumber, counterpartyTeamId, give, receive }).then((result) => {
      if (generation !== assessGeneration.current) return; // a newer pick already won
      setAssessing(false);
      if (!result.ok) {
        setAssessment(null);
        return;
      }
      setAssessment({ verdict: result.data.verdict, givingValue: result.data.givingValue, receivingValue: result.data.receivingValue });
    });
  }, [context.weekNumber, counterpartyTeamId, give, receive, onAssess]);

  const canSend = counterpartyTeamId !== "" && give.length > 0 && receive.length > 0 && !proposing;

  const send = async (): Promise<void> => {
    if (!canSend) return;
    setProposing(true);
    setError(null);
    const result = await onPropose({
      counterpartyTeamId,
      proposerAssets: give.map((playerId) => ({ kind: "player" as const, playerId })),
      counterpartyAssets: receive.map((playerId) => ({ kind: "player" as const, playerId })),
      note: note.trim() === "" ? null : note.trim(),
    });
    setProposing(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSent({ verdict: result.data.verdict.verdict, givingValue: result.data.verdict.givingValue, receivingValue: result.data.verdict.receivingValue });
  };

  if (sent !== null) {
    return (
      <Card>
        <div className="flex flex-col gap-3">
          {/* Fix round 2, F2: converged on "Propose"/"Proposed" as the one completion name for
              this event, per the brief's own original naming rule ("Propose → Proposed") — the
              outbox card already said "Proposed.", so this screen and the submit control below
              change to match it, rather than the reverse. */}
          <p className="text-lg font-medium text-text-primary">Trade proposed.</p>
          {/* Fix round 1, F2 (HIGH, member panel): a first-timer who just sent their first offer
              could not answer "what happens next" from anything this screen showed before. */}
          <p className="text-sm text-text-muted">{`${formatExpiry(PROPOSAL_TTL_DAYS)} If nobody answers by then, it expires on its own and neither roster changes.`}</p>
          <TradeVerdict assessment={sent} />
          <div>
            <Button onClick={onDone}>Done</Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Select
          label="Trade with"
          value={counterpartyTeamId}
          onChange={(event) => {
            setCounterpartyTeamId(event.target.value);
            setReceive([]);
          }}
          options={[{ value: "", label: "Choose a team" }, ...context.counterparties.map((team) => ({ value: team.teamId, label: team.teamName }))]}
        />

        <p className="text-sm text-text-muted">{`Choose up to ${TRADE_CONFIG.maxAssetsPerSide} players on each side.`}</p>

        <div className="flex flex-col gap-4 sm:flex-row">
          <PlayerPicker legend="Your players" roster={myRoster} selected={give} onToggle={(playerId) => setGive((current) => togglePlayer(current, playerId, TRADE_CONFIG.maxAssetsPerSide))} />
          {counterpartyTeamId === "" ? (
            <p className="min-w-0 flex-1 text-sm text-text-muted">Choose a team to see their roster.</p>
          ) : (
            <PlayerPicker legend="Their players" roster={theirRoster} selected={receive} onToggle={(playerId) => setReceive((current) => togglePlayer(current, playerId, TRADE_CONFIG.maxAssetsPerSide))} />
          )}
        </div>

        {assessing ? <p className="text-sm text-text-muted">Checking what the platform thinks of this trade.</p> : null}
        {assessment === null ? null : <TradeVerdict assessment={assessment} />}

        <Textarea
          label="Note (optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={TRADE_CONFIG.noteMaxLength}
          hint="Say why you're offering this, if you want to."
        />

        {error === null ? null : (
          <ErrorState
            title="We couldn't propose that trade."
            description={error}
            action={
              <Button variant="secondary" onClick={() => void send()}>
                Try again
              </Button>
            }
          />
        )}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={proposing} disabled={!canSend}>
            Propose trade
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={proposing}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
