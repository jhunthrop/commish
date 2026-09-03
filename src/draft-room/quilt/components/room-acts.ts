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
  readonly onPeek: (playerId: string) => void;
}
