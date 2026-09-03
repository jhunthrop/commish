"use client";

import { useEffect, useRef, type ReactNode } from "react";

export interface BottomSheetProps {
  /** The dialog's accessible name — say whose or what's sheet this is. */
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/**
 * THE BOTTOM SHEET (founder, 2026-08-30: "it should bring up a pop up from the bottom like a
 * bottom drawer"). A quick look that keeps the reader's place: the screen behind stays where it
 * was, the sheet rises over it, and Escape / the scrim / the close button all put it away.
 *
 * Render it only while open — mounting IS opening, which keeps the state machine at the caller
 * and this component free of a half-open limbo. Focus moves to the panel on mount so Escape and
 * screen readers land inside; `aria-modal` tells assistive tech the page behind is inert.
 */
export function BottomSheet({ label, onClose, children }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 size-full cursor-default bg-black/60" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        // V6: soft raised fill under the overlay shadow token — the hairline went with the
        // warmth pass; `rounded-t-xl` now rides the 20px sheet step the radius scale added.
        className="absolute inset-x-0 bottom-0 mx-auto max-h-[85vh] w-full max-w-5xl animate-sheet-up overflow-y-auto rounded-t-xl bg-surface-raised p-6 shadow-overlay focus-visible:outline-none"
      >
        {children}
      </div>
    </div>
  );
}
