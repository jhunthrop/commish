/**
 * The verbs a league offers a manager that `NEXT_ACTION_COPY` (`@/league/next-action`) does not
 * own, in one place so a surface cannot retype them (C2's rule, applied to the words that grew up
 * outside that table). `NEXT_ACTION_COPY` stays the owner of everything it already names ("Join
 * the draft", "Set your lineup", "Fix your lineup"); these four are the pre-draft and idle-state
 * verbs the waiting room wrote first and the signed-in home now says too.
 */
export const LEAGUE_VERB = {
  /**
   * The word for a week that is still open and a lineup with an empty slot. `NEXT_ACTION_COPY`
   * calls that state `fix-lineup` ("Fix your lineup"), which is right on a row that is telling a
   * manager something is wrong and wrong on a card whose whole sentence is already the week's
   * own; the founder-approved mock says "Set your lineup" there, which is `NEXT_ACTION_COPY`'s
   * own `set-lineup` string. It is spelled HERE rather than imported because the client boundary
   * forbids a value import of `@/league` from a room directory, and `verbs.drift.test.ts`
   * (outside that boundary, where both sides are legal) fails the moment the two spellings
   * disagree — the guard C2 asks for, at the one seam the boundary forces open.
   */
  setLineup: "Set your lineup",
  /**
   * The word for a FULL room whose chosen kickoff has arrived (fix round 2). `nextAction` still
   * reads `open-draft-room` in that moment, because the draft row does not flip to `in_progress`
   * until the start door actually runs, and "Open the draft room" is the weaker word for
   * something this urgent. The same `NEXT_ACTION_COPY` string `join-draft` carries, held to it by
   * `verbs-drift.test.ts`.
   */
  joinDraft: "Join the draft",
  rankSlots: "Rank your draft slots",
  mockDraft: "Run a mock draft",
  previewRoom: "Preview the room",
  openRoom: "Open the room",
} as const;

/** `DraftRoom`'s own "Run it again" contract (`@/draft-room/components/draft-room.tsx`'s
 *  `MOCK_LOBBY_PATH` docblock): immediate solo creation, straight into the room, never the lobby
 *  first. */
export const MOCK_DRAFT_HREF = "/app/draft/mock-drafts?create=solo";
