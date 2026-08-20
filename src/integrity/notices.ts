/**
 * The copy a system-triggered action says to the member it affected. THE one place this text
 * lives: call sites pass structured context, never a string.
 *
 * Not to be confused with `src/identity/notifications.ts`, and named so it cannot be: that module
 * is the CATALOG of topics a user reads on their profile ("what does this product tell me
 * about?"). This one is the WORDS a specific automated action says to a specific person. The
 * phase overview flagged the two as a naming collision before either existed; renaming is the
 * resolution, because two files called `notifications.ts` differ by one word in an import line.
 *
 * Every template obeys two rules, both enforced by `notices.test.ts` rather than by review:
 * nothing accusatory (`INTEGRITY_CONFIG.notices.accusatoryTerms`), and no em-dash.
 */
export interface NoticeContexts {
  readonly draft_auto_picked: {
    readonly leagueName: string;
    readonly pickNumber: number;
    readonly playerName: string;
    readonly position: string;
  };
  readonly review_removed: {
    /** The operator's OWN words, quoted verbatim. Never paraphrased and never filtered. */
    readonly reason: string;
  };
}

export type NoticeType = keyof NoticeContexts;

export interface RenderedNotice {
  readonly title: string;
  readonly body: string;
}

type NoticeTemplate<T extends NoticeType> = (context: NoticeContexts[T]) => RenderedNotice;

export const NOTICE_TEMPLATES: { readonly [T in NoticeType]: NoticeTemplate<T> } = {
  draft_auto_picked: ({ leagueName, pickNumber, playerName, position }) => ({
    title: "Your pick was made automatically",
    body: `The clock ran out on pick ${pickNumber} in ${leagueName}, so we used your queue and drafted ${playerName} (${position}).`,
  }),
  review_removed: ({ reason }) => ({
    title: "Your review was removed",
    body: `An operator removed your review. The reason they gave was: "${reason}". Your review is kept on file exactly as you wrote it.`,
  }),
};

/** One neutral context per type, so the denylist and em-dash checks have something to render. */
export const NOTICE_SAMPLES: { readonly [T in NoticeType]: NoticeContexts[T] } = {
  draft_auto_picked: { leagueName: "Sunday Money", pickNumber: 24, playerName: "Bijan Robinson", position: "RB" },
  review_removed: { reason: "off topic" },
};

export function renderNotice<T extends NoticeType>(type: T, context: NoticeContexts[T]): RenderedNotice {
  return NOTICE_TEMPLATES[type](context);
}
