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
    /**
     * WHICH of three platform-authored reasons the operator picked: `spam`, `abusive` or
     * `other` (`REVIEW_CONFIG.reportReasons`, enforced by `scripts/remove-review.ts` and again
     * by `removeReview`). NOT free text, and not the operator's own prose — it stopped being
     * either the day `--reason` was closed to that vocabulary. Stored as the token, because the
     * token is the honest provenance; MAPPED to a sentence fragment a person can read at every
     * render (`quoteFor` -> `removalPhraseFor`), because a stored value must never be printed
     * raw to the author.
     */
    readonly reason: string;
  };
  /**
   * The one notice `scripts/grant-admin.ts` sends, and the only door this privilege arrives
   * through at all (ruling 15). `grantedByUserId` is the operator id who ran the script, or the
   * literal `"bootstrap"` sentinel on a fresh database's first grant — carried in `context` for
   * the audit trail even though the rendered copy below names no one, because THIS notice is
   * deliberately the one place in this product that tells a member about a privilege rather than
   * an action taken on their own data.
   */
  readonly admin_granted: {
    readonly grantedByUserId: string;
  };
  /**
   * `resolveFlag`'s `warned_user` decision (Task 3): a report stays up, but the operator leaves
   * the author their own words. `note` is free text, the operator's own — NOT bound by this
   * file's denylist (that rulebook binds PLATFORM copy, the templates below; a quote is not the
   * platform's voice) — bound instead by `INTEGRITY_CONFIG.moderation.noteMaxLength`, the same
   * "the service enforces its own boundary" discipline `REVIEW_CONFIG.removalReason.maxLength`
   * uses. `leagueName` is carried separately so the template can say WHERE without the operator
   * having to.
   */
  readonly operator_warning: {
    readonly leagueName: string;
    readonly note: string;
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
    title: "We made your pick for you",
    body: `The clock ran out on pick ${pickNumber} in ${leagueName}, so we used your queue and drafted ${playerName} (${position}). Set your queue before your next draft so this doesn't happen again.`,
  }),
  // `reason` is stored on the row (`context.reason`) but deliberately unused HERE: its
  // author-facing phrase travels as its own field on the wire (`NoticeView.quote`, `GET
  // /api/notices`'s own `quoteFor`), rendered as a distinct blockquote rather than folded into
  // this sentence — a quotation embedded in a paragraph reads as this product's own voice, not
  // a quote.
  review_removed: () => ({
    title: "We removed your review",
    body: "An operator removed your review. We keep your review on file exactly as you wrote it.",
  }),
  admin_granted: () => ({
    title: "You can now use the operator tools",
    body: "Someone with database access turned on operator access for your account. You can open the dispute queue from your account menu. Every decision you record there carries your name and cannot be taken back.",
  }),
  // `note` is stored on the row (`context.note`) but deliberately unused HERE, for the same
  // reason `review_removed`'s `reason` is: the operator's own words travel as their own field on
  // the wire (`quoteFor`), rendered as a distinct blockquote rather than folded into this
  // sentence. The last sentence is founder decision #4, stated rather than implied: there is no
  // appeal path, and a notice that stays silent about that invites a member to go looking for one.
  operator_warning: ({ leagueName }) => ({
    title: "An operator left you a note",
    body: `Somebody reported something you posted in ${leagueName}. An operator read it, decided to leave your post up, and wrote you this note. There is no reply to this message.`,
  }),
};

/** One neutral context per type, so the denylist and em-dash checks have something to render. */
export const NOTICE_SAMPLES: { readonly [T in NoticeType]: NoticeContexts[T] } = {
  draft_auto_picked: { leagueName: "Sunday Money", pickNumber: 24, playerName: "Bijan Robinson", position: "RB" },
  review_removed: { reason: "off topic" },
  admin_granted: { grantedByUserId: "bootstrap" },
  operator_warning: { leagueName: "Sunday Money", note: "Keep the trash talk about the teams." },
};

export function renderNotice<T extends NoticeType>(type: T, context: NoticeContexts[T]): RenderedNotice {
  return NOTICE_TEMPLATES[type](context);
}
