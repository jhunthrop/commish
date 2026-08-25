"use client";

import type { ReactNode } from "react";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

/** The four stagger slots `globals.css` defines (`.rise-1..4`) — the front door hero's whole
 *  entrance vocabulary, and deliberately no more: a fifth riser would mean the band has grown
 *  past what one glance can take in. */
export type RiseStep = 1 | 2 | 3 | 4;

export interface RiseProps {
  readonly step: RiseStep;
  /** Layout classes for the wrapper itself — Rise is a real box in the flow, so the caller
   *  owns its display/gap/width exactly as it would any other div's. */
  readonly className?: string;
  readonly children: ReactNode;
}

/** Explicit map, not a template string, so the classes stay greppable next to `globals.css`. */
const STEP_CLASS: Readonly<Record<RiseStep, string>> = {
  1: "animate-rise rise-1",
  2: "animate-rise rise-2",
  3: "animate-rise rise-3",
  4: "animate-rise rise-4",
};

/**
 * One rising entrance at one of the hero band's four stagger slots (Phase 3.7, Task 7 —
 * `commish-rise`/`rise-1..4`, Task 2's motion CSS). Client-side only for the reduced-motion
 * read: like `Celebration`, less motion is a real BRANCH — the children always render, they
 * simply carry no animation class — never a faster version of the same movement. Server
 * components pass through as `children` untouched, so wrapping a hero in this costs nothing
 * on the server.
 */
export function Rise({ step, className, children }: RiseProps) {
  const reduced = usePrefersReducedMotion();
  const classes = [className, reduced ? "" : STEP_CLASS[step]].filter((part) => part !== undefined && part !== "").join(" ");
  return <div className={classes}>{children}</div>;
}
