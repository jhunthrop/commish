/**
 * THE PILL CHIP'S ONE SPELLING, and the only file in the product that fills one.
 *
 * NO `"use client"`, AND THAT IS THE WHOLE REASON THIS FILE EXISTS (fix round 3). This function
 * lived in `segment-group.tsx`, which is a client module because `SegmentGroup` takes an
 * `onChange` — and `BrowseFilters` (`@/league-room/components/browse-filters`) is a SERVER
 * component, deliberately, so `/browse`'s filter state stays entirely in the URL and works with
 * no JavaScript at all. Calling a client module's export during a server render throws at
 * runtime: *"Attempted to call chipClassName() from the server but chipClassName is on the
 * client."* Every render of `/browse` lost its whole filter nav, and no unit test could see it —
 * jsdom has no server/client boundary. The e2e build is what caught it.
 *
 * A `.tsx` file with no JSX in it, on purpose: `accent-budget.source.test.ts` sweeps `.tsx` and
 * this file fills `bg-accent`, so moving the fill into a `.ts` module would have dodged that
 * guard on a file extension rather than earning its allowlist entry.
 *
 * Three surfaces wear this chip and only one of them can be `SegmentGroup` itself: the lobby's
 * filters are plain `<Link>`s (above), and the mock lobby's table chips are DISCLOSURES that
 * each open their own editor row rather than one mutually exclusive choice. Different
 * mechanisms, one skin — and a call site that hand-rolls the class string still fails the sweep.
 */

/** `md` is the rail a filter row wears; `sm` is the same chip inside a card row. */
export type ChipSize = "md" | "sm";

/**
 * SIDELINE (2026-09-10): the chip's register is the BODY face, sentence case, semibold — the
 * mock's `.chip`. The broadcast rail's tracked small caps left with the direction that asked for
 * them; a chip is a thing a person taps, not a network's chrome.
 */
export const CHIP_SIZE: Readonly<Record<ChipSize, { readonly rail: string; readonly segment: string }>> = {
  md: { rail: "text-sm font-semibold", segment: "px-4 py-2" },
  sm: { rail: "text-sm font-semibold", segment: "px-3 py-1" },
};

/**
 * The chosen chip takes Court blue because Sideline's `accent` IS the chosen-thing pigment, and
 * `self` is now the "yours" channel. Amber's old furniture argument retired with v5.
 */
export function chipClassName(active: boolean, size: ChipSize = "md", className = ""): string {
  const step = CHIP_SIZE[size];
  const base = `rounded-pill ${step.segment} ${step.rail} transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`;
  const skin = active ? "bg-accent text-accent-text" : "bg-surface-elevated text-text-muted hover:text-text-primary";
  return `${base} ${skin} ${className}`.trimEnd();
}
