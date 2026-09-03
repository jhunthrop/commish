"use client";

import { useCallback, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim/50 p-4 sm:items-center">
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
        // V6: the solid amber border becomes the attention treatment the warmth pass names —
        // a soft ring in the accent's own family over the soft fill, with the overlay shadow.
        // "The room is asking you to decide" still reads amber; it just stopped being a wire.
        className={`w-full ${size === "lg" ? "max-w-3xl" : "max-w-2xl"} rounded-xl bg-surface-elevated p-5 shadow-overlay ring-2 ring-accent/40 focus-visible:outline-none`}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id={titleId} className="font-display text-lg font-semibold text-text-primary">
            {title}
          </h2>
          {meta === undefined ? null : <span className="text-sm text-text-muted">{meta}</span>}
          <span className="ml-auto font-mono text-xs text-text-faint">esc backs out</span>
        </div>
        <div className="mt-3 flex flex-col gap-3 text-md text-text-primary">{children}</div>
        <div className="mt-4 flex flex-wrap items-center gap-2">{footer}</div>
      </div>
    </div>
  );
}
