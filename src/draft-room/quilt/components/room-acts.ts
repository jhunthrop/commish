/**
 * The act bundle every quilt surface threads: what the caller may do, and the callbacks that do
 * it. One type, so the drawer tabs, the peek and the mobile tree cannot drift on the contract.
 * `onDraft` always goes through the pick-safety window (`usePendingPick.begin`), never straight
 * to the server.
 */
export interface RoomActs {
  /** True while the caller may act right now (their turn, or an owed pick). */
  readonly canDraft: boolean;
  readonly submitting: boolean;
  readonly queuedPlayerIds: ReadonlySet<string>;
  readonly onDraft: (playerId: string) => void;
  readonly onQueueToggle: (playerId: string) => void;
  /** Opens this room's own draft-context card (`PeekSheet`): board rank, sheet rank, notes,
   *  Draft/Queue. A sibling control to the player's NAME (player-name adoption sweep, task 3)
   *  wherever a row has room for both — the name itself goes through `PlayerName`
   *  (`@/league-room/components/player-peek`), the product's one pressable-name primitive, which
   *  opens the season peek instead. The quilt's own grid cells (`quilt-cell.tsx`,
   *  `quilt-board.tsx`) still use the whole tile as this one control — too small to carry a
   *  second focusable target — so `onPeek` stays their only trigger. */
  readonly onPeek: (playerId: string) => void;
}
