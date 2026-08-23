"use client";

import type { ReactNode } from "react";

export interface RoomLayoutProps {
  readonly rail: ReactNode;
  readonly pool: ReactNode;
  readonly stage: ReactNode;
  readonly dock: ReactNode;
  /**
   * The social column down the right edge — league chat. Optional because the TV board is the
   * same frame with nobody to talk to. It is a fixed-width band that scrolls inside itself,
   * mirroring the pool rail on the left, so the board never moves when a message lands.
   */
  readonly aside?: ReactNode;
}

/**
 * The room's one shape, shared by both formats: a full-height frame with a slim rail across
 * the top, the player pool down the left, the board taking every remaining pixel, and the
 * personal dock along the bottom.
 *
 * Two rules make it feel like a room instead of a page:
 * - **The page never scrolls.** At `lg` and up the frame is exactly `100dvh` and
 *   `overflow-hidden`; the pool and the stage each scroll inside themselves. Rail and dock are
 *   fixed-height bands, so a turn changing never moves the board.
 * - **Below `lg` it linearizes, it does not shrink.** The same four regions become a normal
 *   scrolling column — rail, dock (sticky, so the action is always reachable), board, pool —
 *   and the page scrolls vertically like any other. Squeezing a three-column room onto a
 *   360px phone is how draft rooms end up with tabs.
 *
 * The `order-*` classes are what re-sequence the column on a phone without duplicating any
 * region into a second rendering.
 * - **The aside is the social band.** Same width and scroll rule as the pool, mirrored to the
 *   right edge with a left border. Below `lg` it linearizes last, under the pool — chat is the
 *   thing you scroll to on a phone, never the thing between you and the board.
 */
export function RoomLayout({ rail, pool, stage, dock, aside }: RoomLayoutProps) {
  return (
    <div data-testid="room-layout" className="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <div className="order-1">{rail}</div>
      <div className="order-3 flex min-h-0 flex-1 flex-col lg:order-2 lg:flex-row">
        <div className="order-2 min-w-0 border-line lg:order-1 lg:w-88 lg:shrink-0 lg:overflow-hidden lg:border-r">{pool}</div>
        {/* overflow-HIDDEN, not auto: the board grid inside the stage is the one horizontal
            scroller. Two nested auto containers rendered two scrollbars stacked on each other. */}
        <div className="order-1 min-w-0 lg:order-2 lg:min-h-0 lg:flex-1 lg:overflow-hidden">{stage}</div>
        {aside === undefined ? null : (
          <div
            data-testid="room-aside"
            className="order-3 min-w-0 border-line lg:order-3 lg:shrink-0 lg:overflow-hidden lg:border-l"
          >
            {/* Width lives on the aside CONTENT (lg:w-88 open, slim strip collapsed) so the
                band can collapse without this frame knowing chat exists. */}
            {aside}
          </div>
        )}
      </div>
      <div className="sticky top-0 z-10 order-2 lg:static lg:order-3">{dock}</div>
    </div>
  );
}
