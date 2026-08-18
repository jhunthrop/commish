"use client";

import { useEffect, useState } from "react";
import type { DraftStateView } from "@/draft-engine";
import { Button, Input, Modal } from "@/components/ui";

export interface NominateModalProps {
  readonly open: boolean;
  readonly playerId: string | null;
  readonly playerName: string;
  readonly view: DraftStateView;
  /**
   * The legal opening bid floor. A plain `number`, not `view.minBid` (which is `number | null`
   * — null only before an auction has started): this modal only ever renders once nominating
   * is possible, so its caller narrows `view.minBid` to a number before rendering it, and no
   * magic fallback literal is needed here.
   */
  readonly minBid: number;
  readonly myTeamId: string | null;
  readonly onClose: () => void;
  readonly onNominate: (playerId: string, openingBid: number) => void;
}

/** Nominating commits money, so it gets a deliberate confirm step rather than a single click. */
export function NominateModal({ open, playerId, playerName, view, minBid, myTeamId, onClose, onNominate }: NominateModalProps) {
  const maxBid = myTeamId === null ? null : (view.maxBids[myTeamId] ?? null);
  const [openingBid, setOpeningBid] = useState(minBid);

  useEffect(() => {
    setOpeningBid(minBid);
  }, [minBid, playerId]);

  return (
    <Modal
      open={open}
      title={`Nominate ${playerName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={playerId === null}
            onClick={() => {
              if (playerId !== null) onNominate(playerId, openingBid);
            }}
          >
            {`Nominate for $${openingBid}`}
          </Button>
        </>
      }
    >
      <Input
        label="Opening bid"
        type="number"
        inputMode="numeric"
        value={openingBid}
        min={minBid}
        max={maxBid ?? undefined}
        hint={maxBid === null ? `At least $${minBid}.` : `Between $${minBid} and $${maxBid}.`}
        onChange={(event) => setOpeningBid(Number(event.target.value))}
      />
    </Modal>
  );
}
