/** The advisor tab's own client-side tunables. Server tunables live in
 *  `@/draft-service/assistant/config`, which client code may not value-import; the survival
 *  bands both sides colour by live in `@/domain/draft-odds`. */
export const ADVISOR_ROOM_CONFIG = {
  /** How many drafts' worth of advisor state the tab remembers across remounts. */
  rememberedDrafts: 5,
  /** Rows the demo's odds list shows per filter. */
  demoListSize: 12,
  /**
   * How long the advisor waits for the server's `draft.facts` frame after a commit before asking
   * `/assistant` anyway (review M5). Past the facts compute at its slowest measured (2.2 s) with
   * margin; a frame that never comes means the writer died or the stream missed it, and the
   * request then computes once, which is the miss's honest cost.
   */
  factsWaitMaxMs: 8_000,
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
