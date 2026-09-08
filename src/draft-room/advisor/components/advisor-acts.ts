/**
 * What the advisor's now card may do — the room's own `RoomActs` narrowed to the two verbs the
 * card carries (spec 3.2: Draft on the clock through the pool's own pick path and its
 * confirmation rules, Queue otherwise through the queue that already exists), plus the queue's
 * order so a queued row can say where it sits.
 */
export interface AdvisorActs {
  readonly canDraft: boolean;
  readonly submitting: boolean;
  /** Player id -> 1-based position in the manager's own queue. */
  readonly queueOrder: ReadonlyMap<string, number>;
  readonly onDraft: (playerId: string) => void;
  readonly onQueueToggle: (playerId: string) => void;
}
