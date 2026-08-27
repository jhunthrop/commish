"use client";

import type { ReactNode } from "react";
import { Button, Modal } from "@/components/ui";
import type { ButtonVariant } from "@/components/ui/button";

export interface ConfirmModalProps {
  readonly open: boolean;
  /** Also the dialog's accessible name — names the OBJECT the act is about ("Dissolve The Blitz
   *  Room?"), never a generic "Are you sure?". */
  readonly title: string;
  /** The exact consequence, stated as a fact the operator can check against what they meant to
   *  do — a name, a count, an amount. `ReactNode` rather than `string`: settle's own confirm
   *  names every place against every prize, which a template literal cannot format legibly. */
  readonly body: ReactNode;
  /** The confirming button's OWN label — never "Confirm" (operator review, R2): it names the
   *  act on the object ("Dissolve The Blitz Room"), so the last thing an operator reads before
   *  an irreversible press is the exact sentence they are agreeing to, not a bare
   *  acknowledgement. */
  readonly confirmLabel: string;
  /** `"destructive"` by default — every act this modal guards is one-way. A caller passes
   *  `"primary"` for the one non-destructive exit in the cluster (paying a held balance back to
   *  its owner) so the ink stays reserved for the one act genuinely worth the loudest color in
   *  view (Sunday Standard rule 5: the confirm's own button is that view's one ink action). */
  readonly variant?: ButtonVariant;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/**
 * The ONE confirm dialog every dangerous act in the admin room routes through (operator review,
 * 2026-08-27, findings D1/D3/R2) — extracted from `HeldTradeDetail`'s own private `ConfirmModal`,
 * the single control in the whole cluster that already asked before it acted. Dissolve, settle,
 * release, confiscate and clear-exclusion all render this same shape now, rather than five
 * hand-rolled copies that could drift apart on focus order or copy discipline.
 *
 * `Modal` itself puts focus on the first focusable descendant, which is `Cancel` here (it renders
 * before the confirm button in the footer) — a keyboard user who reaches this dialog by habit, or
 * whose thumb slips on Enter, lands on the safe choice, never the destructive one. Escape closes
 * it the same way `Cancel` does (`Modal`'s own handler).
 */
export function ConfirmModal({ open, title, body, confirmLabel, variant = "destructive", busy, onCancel, onConfirm }: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={variant} loading={busy} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body}
    </Modal>
  );
}
