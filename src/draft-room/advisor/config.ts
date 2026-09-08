/** The advisor tab's own client-side tunables. Server tunables live in
 *  `@/draft-service/assistant/config`, which client code may not value-import; the survival
 *  bands both sides colour by live in `@/domain/draft-odds`. */
export const ADVISOR_ROOM_CONFIG = {
  /** How many drafts' worth of advisor state the tab remembers across remounts. */
  rememberedDrafts: 5,
  /** Rows the demo's odds list shows per filter. */
  demoListSize: 12,
} as const;
