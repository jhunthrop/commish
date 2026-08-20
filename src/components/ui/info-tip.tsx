"use client";

import { useEffect, useId, useState } from "react";
import type { HelpLevel } from "@/identity/preferences";
import { term as glossaryTerm, type TermKey } from "@/help/glossary";
import { Icon } from "./icon";

export interface InfoTipProps {
  readonly term: TermKey;
  readonly className?: string;
  /**
   * `"guided"` additionally prints the glossary entry's `short` line inline, right below the
   * trigger, so a first-timer reads it without knowing there was anything to click. Omitted (or
   * `"standard"`), only the click-to-reveal trigger renders — the same control either way, one
   * extra branch, not a second component.
   */
  readonly helpLevel?: HelpLevel;
}

/**
 * The ONE way a glossary definition appears anywhere in the product — every caller passes a
 * `TermKey`, never an inline string, so a definition can only ever say one thing.
 *
 * Click, never hover: WCAG 2.2's 1.4.13 (Content on Hover or Focus) fails a hover-only reveal,
 * and hover does not exist at all on this product's minimum viewport (360px, no mouse). The
 * trigger is a real `<button>` with `aria-expanded`, and the definition it opens sits in normal
 * document flow directly beneath it — never a `position: absolute` overlay — so revealing it can
 * never cover the button, or anything else on the page, at any width.
 */
export function InfoTip({ term, className, helpLevel }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const entry = glossaryTerm(term);
  const noteId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <span className={`inline-flex flex-col items-start gap-1 align-middle ${className ?? ""}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={noteId}
        aria-label={`What is ${entry.term}?`}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon name="info" size={14} />
      </button>
      {helpLevel === "guided" ? <span className="max-w-[280px] text-xs text-text-muted">{entry.short}</span> : null}
      {open ? (
        <span id={noteId} role="note" className="max-w-[280px] text-xs text-text-muted">
          {entry.detail}
        </span>
      ) : null}
    </span>
  );
}
