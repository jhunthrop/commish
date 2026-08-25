import type { ReactNode } from "react";
import type { TermKey } from "@/help/glossary";

export interface TermLinkProps {
  readonly term: TermKey;
  readonly children: ReactNode;
}

/**
 * E10 (Task 10): `/league-rules`'s prose used to carry a term as an `InfoTip` trigger sitting
 * right next to it — a second control a reader had to click, on a page whose whole point is that
 * it already reads start to finish. `TermLink` is a plain in-page anchor instead: it jumps
 * straight down to `GlossarySection`'s matching `id="term-${term}"`, so the definition is one
 * anchor away rather than a popover to open. `InfoTip` itself is untouched — this is a second,
 * simpler way to point at a `GLOSSARY` term, for a reading page rather than a glancing one.
 */
export function TermLink({ term, children }: TermLinkProps) {
  return (
    <a href={`#term-${term}`} className="text-text-primary underline decoration-dotted underline-offset-4 hover:text-accent">
      {children}
    </a>
  );
}
