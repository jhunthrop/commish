"use client";

import { useEffect, useState } from "react";
import type { DraftStateView } from "@/draft-engine";
import { Button, Input } from "@/components/ui";

export interface BidControlsProps {
  readonly view: DraftStateView;
  readonly myTeamId: string | null;
  readonly submitting: boolean;
  readonly onBid: (amount: number) => void;
}

/**
 * Every number here is the server's: `view.minBid` is the floor the engine computed and
 * `view.maxBids[myTeamId]` is this team's reserve-adjusted ceiling. The reserve formula does
 * not exist in this file, or anywhere else in React.
 */
export function BidControls({ view, myTeamId, submitting, onBid }: BidControlsProps) {
  const lot = view.auction?.lot ?? null;
  const minBid = view.minBid;
  const maxBid = myTeamId === null ? null : (view.maxBids[myTeamId] ?? null);
  const [amount, setAmount] = useState(minBid ?? 0);

  useEffect(() => {
    if (minBid !== null) setAmount(minBid);
  }, [minBid]);

  const blocked =
    myTeamId === null
      ? "You are watching this one. No team in it."
      : lot === null || minBid === null
        ? "Nobody is up for bid right now."
        : lot.highBidTeamId === myTeamId
          ? "You're the high bidder."
          : maxBid === null || maxBid < minBid
            ? "You can't afford the current bid and still fill your roster."
            : null;

  // One-tap increments for a bid war (review R5): stepping clamps at the server's own
  // ceiling, and refuses exactly when bidding itself is blocked — the input stays the
  // precision path for any other number.
  const step = (by: number): void => setAmount((current) => (maxBid === null ? current : Math.min(maxBid, current + by)));
  const atCeiling = maxBid !== null && amount >= maxBid;

  return (
    // A row, not a stack: this is the dock's primary slot during a live lot, and the dock is a
    // fixed-height band. Label above, hint below, buttons beside — one line of the room's height.
    <div data-testid="bid-console" className="flex shrink-0 items-end gap-2">
      <Input
        label="Your bid"
        type="number"
        inputMode="numeric"
        value={amount}
        min={minBid ?? undefined}
        max={maxBid ?? undefined}
        disabled={blocked !== null}
        hint={blocked ?? `Between $${minBid} and $${maxBid}.`}
        onChange={(event) => setAmount(Number(event.target.value))}
      />
      <Button variant="secondary" size="sm" disabled={blocked !== null || atCeiling} onClick={() => step(1)}>
        +$1
      </Button>
      <Button variant="secondary" size="sm" disabled={blocked !== null || atCeiling} onClick={() => step(5)}>
        +$5
      </Button>
      <Button disabled={blocked !== null} loading={submitting} onClick={() => onBid(amount)}>
        Bid
      </Button>
    </div>
  );
}
