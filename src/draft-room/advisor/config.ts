/** The advisor tab's own client-side tunables. Server tunables live in
 *  `@/draft-service/assistant/config`, which client code may not value-import; the survival
 *  bands both sides colour by live in `@/domain/draft-odds`. */
export const ADVISOR_ROOM_CONFIG = {
  /** How many drafts' worth of advisor state the tab remembers across remounts. */
  rememberedDrafts: 5,
  /** Rows the demo's odds list shows per filter. */
  demoListSize: 12,
  /** The tab's pick-count selector: how many of the shortlist it shows, the lead card counted
   *  as the first. The largest option is the server's `shortlistSize`, so no choice needs a
   *  second request. Remembered per browser under the key, read in a try/catch. */
  pickCount: {
    options: [3, 5, 10],
    default: 5,
    storageKey: "commish.advisor-pick-count",
  },
} as const;

export type PickCount = (typeof ADVISOR_ROOM_CONFIG.pickCount.options)[number];
