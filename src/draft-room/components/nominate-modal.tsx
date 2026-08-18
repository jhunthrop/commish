"use client";

import { useEffect, useState } from "react";
import type { DraftStateView } from "@/draft-engine";
import { Button, Input, Modal } from "@/components/ui";

export interface NominateModalProps {
  readonly open: boolean;
  readonly playerId: string | null;
  readonly playerName: string;
  readonly view: DraftStateView;
  readonly myTeamId: string | null;
  readonly onClose: () => void;
  readonly onNominate: (playerId: string, openingBid: number) => void;
}

/** Nominating commits money, so it gets a deliberate confirm step rather than a single click. */
export function NominateModal({ open, playerId, playerName, view, myTeamId, onClose, onNominate }: NominateModalProps) {
  const minBid = view.minBid ?? 1;
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
