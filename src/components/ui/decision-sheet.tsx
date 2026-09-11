"use client";

import { useCallback, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useEntranceClass } from "@/design/use-motion";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DecisionSheetProps {
  readonly open: boolean;
  /** Also the dialog's accessible name. Set in the display face — this is a headline, not a form. */
  readonly title: string;
  /** The one-line context beside the title ("Zay Flowers is on bye Sunday", "expires Fri 9:00 PM"). */
  readonly meta?: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** The verbs row. The caller supplies the buttons; exactly one of them should be the filled
   *  amber verb (`Button variant="verb"`), because nothing commits until that one. */
  readonly footer: ReactNode;
  /** The trade sheet needs more shoulder room than the lineup fix. */
  readonly size?: "md" | "lg";
}

/**
 * A DECISION SHEET — law 3 of the league room. Not a page and not a form: a finished diagnosis
 * with its evidence, and one amber verb that commits. Distinct from `Modal` on purpose: the
 * accent attention ring marks "the room is asking you to decide", the title sits in the display face
 * with its context beside it, and the footer is a verbs row rather than a Close button.
 *
 * Mechanics follow `Modal`'s APG dialog pattern exactly: renders nothing while closed, takes
 * focus on open, hands it back on close, traps Tab, and Escape backs out without committing.
 */
export function DecisionSheet({ open, title, meta, onClose, children, footer, size = "md" }: DecisionSheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const entrance = useEntranceClass();

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
    first?.focus();
    return () => {
      openerRef.current?.focus();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        // The sheet consumes the key: esc backs out of the decision before it collapses
        // anything behind it (the drawer's own esc listens at the window).
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (panel === null) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    // SIDELINE: "sheets slide up over a blurred ground". The blur is on the scrim, so the room
    // behind the decision is still legibly there and no longer competing for the eye.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim/50 p-4 backdrop-blur-sm sm:items-center">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the WAI-ARIA
          APG dialog pattern: the keydown handler traps Tab focus inside the panel, which has to
          live on the dialog container itself, not on an individual focusable child. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        // SIDELINE WAVE TWO: the sheet is the system's one material — 20px corners
        // (`shape.sheet`), the overlay shadow, and the attention ring in the accent's own GLOW
        // role rather than a hand-mixed opacity, so the ring is the same tint `Badge`'s own glow
        // spends. It springs in on arrival (`useEntranceClass`), which is P4's "anything that
        // appears" verb and the only motion this component makes.
        className={`w-full ${size === "lg" ? "max-w-3xl" : "max-w-2xl"} rounded-xl bg-surface-elevated p-5 shadow-overlay ring-2 ring-accent-glow focus-visible:outline-none ${entrance}`}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id={titleId} className="font-display text-lg font-semibold text-text-primary">
            {title}
          </h2>
          {/* P7 (no explainer text): "esc backs out" is gone. It was a sentence whose only job was
              to explain another element, and Escape still backs out — the behaviour did not need
              printing on the surface it belongs to. */}
          {meta === undefined ? null : <span className="text-sm text-text-muted">{meta}</span>}
        </div>
        <div className="mt-3 flex flex-col gap-3 text-md text-text-primary">{children}</div>
        <div className="mt-4 flex flex-wrap items-center gap-2">{footer}</div>
      </div>
    </div>
  );
}
