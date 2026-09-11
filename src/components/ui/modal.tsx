"use client";

import { useCallback, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useEntranceClass } from "@/design/use-motion";
import { Button } from "./button";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where the panel sits: the middle of the viewport (a decision), or anchored near the top (a
 *  palette whose list grows downward as the reader types). */
export type ModalPlacement = "center" | "top";

/** `md` is a decision's width, `lg` a list's, `xl` a research surface's — the player peek, which
 *  carries the same modules his own page carries and wants the two-column grid to survive. */
export type ModalSize = "md" | "lg" | "xl";

export interface ModalProps {
  readonly open: boolean;
  /** Also the dialog's accessible name. */
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Replaces the default "Close" button row; `null` renders no footer row at all. */
  readonly footer?: ReactNode | null;
  /** @default "center" */
  readonly placement?: ModalPlacement;
  /** @default "md" */
  readonly size?: ModalSize;
  /** Keeps the title as the accessible name only; the heading is still rendered, `sr-only`. */
  readonly titleHidden?: boolean;
}

/**
 * The two placements, each spelling its own whole geometry. `center` is a sheet from the foot of
 * a phone and a centred card above `sm`; `top` is full-screen below `sm` and a top-anchored panel
 * above. Both are Sideline's 20px sheet (`rounded-xl`).
 */
const PLACEMENT: Readonly<Record<ModalPlacement, { readonly scrim: string; readonly panel: string }>> = {
  // THE CENTRE PLACEMENT IS A BOTTOM SHEET ON A PHONE AND A CARD ON A DESKTOP, which is Sideline's
  // one modal geometry and why the peek needs no second component: `items-end` pins it to the foot
  // of the viewport below `sm` with only its top corners rounded, and centres it above. The height
  // cap and the scroll are the sheet's ("sheets slide up over a blurred ground", max 85vh on the
  // phone), so a long body scrolls INSIDE the panel and never takes the page behind it with it.
  center: { scrim: "items-end justify-center p-0 sm:items-center sm:p-4", panel: "max-h-[85vh] overflow-y-auto rounded-t-xl sm:max-h-[90vh] sm:rounded-xl" },
  top: { scrim: "items-stretch justify-center p-0 sm:items-start sm:p-4 sm:pt-[10vh]", panel: "rounded-none sm:rounded-xl" },
};

const SIZE: Readonly<Record<ModalSize, string>> = {
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-5xl",
};

/**
 * A focus-trapped dialog over a blurred ground (Sideline: "sheets slide up over a blurred
 * ground"). Renders nothing when closed. On open it springs in and takes focus; on close it hands
 * focus back to whatever had it, so a keyboard user never loses their place.
 */
export function Modal({ open, title, onClose, children, footer, placement = "center", size = "md", titleHidden = false }: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const entrance = useEntranceClass("in");

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
    <div className={`fixed inset-0 z-50 flex bg-scrim/40 backdrop-blur-sm ${PLACEMENT[placement].scrim}`}>
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
        className={`w-full ${SIZE[size]} ${PLACEMENT[placement].panel} bg-surface-elevated p-4 shadow-overlay focus-visible:outline-none ${entrance}`.trimEnd()}
      >
        <h2 id={titleId} className={titleHidden ? "sr-only" : "font-display text-xl font-bold text-text-primary"}>
          {title}
        </h2>
        <div className={`${titleHidden ? "" : "mt-3 "}text-md text-text-primary`}>{children}</div>
        {footer === null ? null : (
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {footer ?? (
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
