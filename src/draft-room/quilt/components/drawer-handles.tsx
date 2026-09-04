"use client";

import { useRef } from "react";
import { Icon } from "@/components/ui/icon";
import { MICRO_LABEL } from "@/components/ui/config";
import { DRAWER_TABS, type CollapseEvent, type DrawerTab, type ExpandedSurface } from "../state/collapse";
import { QUILT_CONFIG } from "../state/config";

/** Sentence case per the v6 label ruling — the shouted register belongs to `MICRO_LABEL` alone. */
const TAB_LABEL: Readonly<Record<DrawerTab, string>> = {
  pool: "Pool",
  sheet: "My sheet",
  roster: "Roster",
  byes: "Byes",
  picks: "Picks",
};

export interface DrawerHandlesProps {
  readonly surface: ExpandedSurface;
  readonly dispatch: (event: CollapseEvent) => void;
  /** Byes needs bye data to say anything — same rule as the lens chip. */
  readonly hasByes: boolean;
  /** Roster needs a team of the caller's own — a commissioner has nothing this tab can show
   *  (the "nothing to say" law, same gating shape as Byes). */
  readonly hasRoster: boolean;
}

/**
 * THE HANDLES ON THE EDGE (founder addition 2, WarmQuilt mock): the drawer's tabs ride its top
 * edge as always-visible rounded-top handles — at EVERY height, collapsed included — plus a
 * grabber pill that says its own gesture ("drag or tap · space"). Opening or closing is never
 * a mystery gesture, and none of it is new semantics: every affordance dispatches the collapse
 * machine's existing events (`SET_TAB` opens at half on that surface, `TOGGLE_DRAWER` walks
 * down, `SET_HEIGHT` sizes), so the keyboard map and these handles can never disagree.
 *
 * The chevron flips with state: OPEN, it rides the active tab pointing down (a tap walks the
 * drawer down); COLLAPSED, no tab is active, so it rides the default Pool tab pointing up (a
 * tap opens). The mock draws one static frame; the flip rule is the spec's recorded judgment.
 *
 * The grabber's drag is one honest step per gesture: released upward it raises (collapsed to
 * half, half to full), released downward it lowers (full to half, half to closed); a
 * sub-threshold wiggle is a tap, which is space's own toggle.
 */
export function DrawerHandles({ surface, dispatch, hasByes, hasRoster }: DrawerHandlesProps) {
  const open = surface.kind === "drawer";
  const activeTab = open ? surface.tab : null;
  const chevronTab: DrawerTab = activeTab ?? "pool";
  const dragStartY = useRef<number | null>(null);
  const dragHandled = useRef(false);

  const raise = (): void => {
    if (!open) dispatch({ type: "SET_HEIGHT", height: "half" });
    else if (surface.height === "half") dispatch({ type: "SET_HEIGHT", height: "full" });
  };
  const lower = (): void => {
    if (!open) return;
    if (surface.height === "full") dispatch({ type: "SET_HEIGHT", height: "half" });
    else dispatch({ type: "COLLAPSE_ALL" });
  };

  return (
    <div data-testid="drawer-handles" className="flex items-end gap-1.5 px-4">
      <div role="tablist" aria-label="Drawer surfaces" className="flex items-end gap-1.5">
        {DRAWER_TABS.filter((candidate) => (candidate !== "byes" || hasByes) && (candidate !== "roster" || hasRoster)).map((candidate) => {
          const active = activeTab === candidate;
          return (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => dispatch(active ? { type: "TOGGLE_DRAWER" } : { type: "SET_TAB", tab: candidate })}
              className={`flex items-center gap-1.5 rounded-t-md px-4 pb-2 pt-1.5 font-display text-sm font-bold tracking-wide focus-visible:outline-2 focus-visible:outline-accent ${
                active ? "bg-surface-elevated text-accent" : "bg-surface-inset text-text-muted"
              }`}
            >
              {TAB_LABEL[candidate]}
              {candidate === chevronTab ? (
                <span
                  data-testid="handle-chevron"
                  aria-hidden="true"
                  className={`inline-flex transition-transform duration-200 motion-reduce:transition-none ${open ? "" : "rotate-180"}`}
                >
                  <Icon name="chevron-down" size={12} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        data-testid="drawer-grabber"
        aria-label={open ? "Drag or tap to close the pool. Space toggles it." : "Drag or tap to open the pool. Space toggles it."}
        onPointerDown={(event) => {
          dragStartY.current = event.clientY;
          // A real drag leaves this small button before release. Capture routes the pointerup
          // back here regardless of what the pointer ends up over; without it the gesture is
          // dead in a browser even though jsdom tests (same-target dispatch) stay green.
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          const start = dragStartY.current;
          dragStartY.current = null;
          if (start === null) return;
          const delta = event.clientY - start;
          if (Math.abs(delta) < QUILT_CONFIG.drawerDragThresholdPx) return;
          dragHandled.current = true;
          if (delta < 0) raise();
          else lower();
        }}
        onPointerCancel={(event) => {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          dragStartY.current = null;
        }}
        style={{ touchAction: "none" }}
        onClick={() => {
          if (dragHandled.current) {
            dragHandled.current = false;
            return;
          }
          dispatch({ type: "TOGGLE_DRAWER" });
        }}
        className="ml-auto flex flex-col items-center gap-1 rounded-t-md bg-surface-elevated px-5 pb-1.5 pt-2 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span aria-hidden="true" className="h-1 w-9 rounded-pill bg-edge" />
        <span aria-hidden="true" className={`${MICRO_LABEL} text-text-faint`}>
          drag or tap · space
        </span>
      </button>
    </div>
  );
}
