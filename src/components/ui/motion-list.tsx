"use client";

import { Fragment, useEffect, useLayoutEffect, useState, type ReactNode, type RefCallback } from "react";
import { MOTION } from "@/design/motion";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

/** What a row spreads onto its own list-item element so the list can move, enter and leave it. */
export interface MotionRowProps {
  readonly ref: RefCallback<HTMLElement>;
  readonly "data-motion-key": string;
  readonly className: string;
  /** A leaving row is a ghost: inert to pointer, keyboard and assistive tech while it fades. */
  readonly inert?: boolean;
  readonly "aria-hidden"?: true;
}

export interface MotionListProps<T> {
  readonly items: readonly T[];
  readonly keyOf: (item: T) => string;
  /** Renders one row; the row MUST spread `row` onto its list-item element. */
  readonly children: (item: T, row: MotionRowProps) => ReactNode;
}

interface Memory<T> {
  readonly items: readonly T[];
  /** Every key ever rendered, so a key seen for the first time after mount is an entrance. */
  readonly known: ReadonlySet<string>;
  /** Keys that entered after mount; the entrance class stays on them (a CSS animation plays
   *  once per element, so the class is sticky rather than removed a render later, which would
   *  cut the fade short whenever the list re-renders inside its 200 ms). */
  readonly entered: ReadonlySet<string>;
  /** Rows removed from `items` and held for the leave fade, with the item they last rendered. */
  readonly leaving: ReadonlyMap<string, T>;
  /** What the list last rendered, ghosts included — the order a leaving row is placed by. */
  readonly rendered: readonly T[];
}

const NO_MOVE_PX = 0.5;
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function remember<T>(memory: Memory<T>, items: readonly T[], keyOf: (item: T) => string, holdLeavers: boolean): Memory<T> {
  const current = new Set(items.map(keyOf));
  const entered = new Set(memory.entered);
  for (const key of current) if (!memory.known.has(key)) entered.add(key);
  const leaving = new Map([...memory.leaving].filter(([key]) => !current.has(key)));
  if (holdLeavers) {
    for (const item of memory.items) {
      const key = keyOf(item);
      if (!current.has(key) && !leaving.has(key)) leaving.set(key, item);
    }
  }
  return { items, known: new Set([...memory.known, ...current]), entered, leaving, rendered: interleave(items, memory.rendered, leaving, keyOf) };
}

function forget<T>(memory: Memory<T>, key: string, keyOf: (item: T) => string): Memory<T> {
  if (!memory.leaving.has(key)) return memory;
  return { ...memory, leaving: new Map([...memory.leaving].filter(([held]) => held !== key)), rendered: memory.rendered.filter((item) => keyOf(item) !== key) };
}

/** Leaving rows sit right after the nearest present row they used to follow, so a ghost fades
 *  where the row was rather than jumping to the end. */
function interleave<T>(items: readonly T[], previous: readonly T[], leaving: ReadonlyMap<string, T>, keyOf: (item: T) => string): readonly T[] {
  if (leaving.size === 0) return items;
  const present = new Set(items.map(keyOf));
  const after = new Map<string | null, T[]>();
  let anchor: string | null = null;
  for (const item of previous) {
    const key = keyOf(item);
    if (present.has(key)) anchor = key;
    else if (leaving.has(key)) after.set(anchor, [...(after.get(anchor) ?? []), item]);
  }
  return [...(after.get(null) ?? []), ...items.flatMap((item) => [item, ...(after.get(keyOf(item)) ?? [])])];
}

function rowClassName(entered: boolean, leaving: boolean): string {
  return [MOTION.reorder.className, entered ? MOTION.enter.className : "", leaving ? MOTION.leave.className : ""].filter(Boolean).join(" ");
}

/**
 * A LIST WHOSE ROWS MOVE INSTEAD OF POPPING (founder report 2026-09-10): rows that change place
 * slide there (FLIP: measure before, measure after, play the difference back as a transform),
 * a row that appears fades in, a row that goes fades out in place before it leaves the DOM.
 * Nothing animates on the list's own mount (law 6). With reduced motion the fades are what
 * `globals.css` makes of them, nothing slides, and a leaving row leaves at once.
 *
 * The caller owns the `<ol>`; this renders the rows and hands each one a `MotionRowProps` it
 * must spread onto its list item. Those props are cached per key and rebuilt only when the
 * row's phase changes, so a memoized row component sees the same object across renders and
 * skips — the whole point of the round is that a pick landing re-renders one row, not sixty.
 */
export function MotionList<T>({ items, keyOf, children }: MotionListProps<T>) {
  const reduced = usePrefersReducedMotion();
  const [memory, setMemory] = useState<Memory<T>>(() => ({ items, known: new Set(items.map(keyOf)), entered: new Set(), leaving: new Map(), rendered: items }));
  const [nodes] = useState(() => new Map<string, HTMLElement>());
  const [positions] = useState(() => new Map<string, number>());
  const [rowProps] = useState(() => new Map<string, MotionRowProps>());
  const [timers] = useState(() => new Map<string, ReturnType<typeof setTimeout>>());

  // Derived during render (React's "storing information from previous renders" idiom), never in
  // an effect: an effect would run after React had already pulled the leaving rows out of the
  // DOM, and putting them back a frame later is the flicker this exists to remove.
  const current = memory.items === items ? memory : remember(memory, items, keyOf, !reduced);
  if (current !== memory) setMemory(current);

  useEffect(() => {
    for (const key of current.leaving.keys()) {
      if (timers.has(key)) continue;
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          setMemory((held) => forget(held, key, keyOf));
        }, MOTION.leave.durationMs),
      );
    }
    for (const [key, timer] of timers) {
      if (!current.leaving.has(key)) {
        clearTimeout(timer);
        timers.delete(key);
      }
    }
  }, [current.leaving, timers, keyOf]);

  useEffect(() => () => timers.forEach((timer) => clearTimeout(timer)), [timers]);

  useIsomorphicLayoutEffect(() => {
    // All reads, then all writes, then ONE forced layout: a write between reads would force a
    // layout per moved row (measured once at 11.8 s for a long list before this was batched).
    const next = new Map<string, number>();
    for (const [key, node] of nodes) next.set(key, node.getBoundingClientRect().top);
    if (!reduced) {
      const moves: { readonly node: HTMLElement; readonly deltaPx: number }[] = [];
      for (const [key, top] of next) {
        const before = positions.get(key);
        const node = nodes.get(key);
        if (before === undefined || node === undefined || Math.abs(before - top) < NO_MOVE_PX) continue;
        moves.push({ node, deltaPx: before - top });
      }
      playMoves(moves);
    }
    positions.clear();
    for (const [key, top] of next) positions.set(key, top);
  });

  return (
    <>
      {current.rendered.map((item) => {
        const key = keyOf(item);
        const row = propsFor(rowProps, nodes, key, current.entered.has(key), current.leaving.has(key));
        return <Fragment key={key}>{children(item, row)}</Fragment>;
      })}
    </>
  );
}

/** FLIP's play step: start every moved row where it was (one batch of writes, one forced
 *  layout), then let the class's transition carry them home on the next frame. */
function playMoves(moves: readonly { readonly node: HTMLElement; readonly deltaPx: number }[]): void {
  if (moves.length === 0) return;
  for (const { node, deltaPx } of moves) {
    node.style.transition = "none";
    node.style.transform = `translateY(${deltaPx}px)`;
  }
  void moves[0]!.node.offsetHeight;
  requestAnimationFrame(() => {
    for (const { node } of moves) {
      node.style.transition = "";
      node.style.transform = "";
    }
  });
}

function propsFor(cache: Map<string, MotionRowProps>, nodes: Map<string, HTMLElement>, key: string, entered: boolean, leaving: boolean): MotionRowProps {
  const className = rowClassName(entered, leaving);
  const held = cache.get(key);
  if (held !== undefined && held.className === className) return held;
  const ref: RefCallback<HTMLElement> = held?.ref ?? ((node) => {
    if (node === null) nodes.delete(key);
    else nodes.set(key, node);
  });
  const props: MotionRowProps = leaving
    ? { ref, "data-motion-key": key, className, inert: true, "aria-hidden": true }
    : { ref, "data-motion-key": key, className };
  cache.set(key, props);
  return props;
}
