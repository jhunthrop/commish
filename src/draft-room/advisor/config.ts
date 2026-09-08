/** The advisor tab's own client-side tunables. Server tunables live in
 *  `@/draft-service/assistant/config`, which client code may not value-import. */
export const ADVISOR_ROOM_CONFIG = {
  /** How soon the tab asks again while the writer's answer is still `pending`. */
  voicePollMs: 2_500,
  /** "Changed since": a plan target's odds moving by more than this band is called out. */
  changedOddsBand: 0.15,
  /** Changed-since names shown before the rest collapse to a count. */
  changedSinceMaxLines: 3,
  /** Signal chips a phone shows before the "More" disclosure. */
  mobileChipCount: 3,
  /** How many drafts' worth of advisor state the tab remembers across remounts. */
  rememberedDrafts: 5,
} as const;
