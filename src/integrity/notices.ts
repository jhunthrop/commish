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
  /**
   * `removeChatMessageInTx`'s (`@/chat-service/moderation`) own notice, mirroring `review_removed`
   * field for field: `reason` is one of the SAME closed tokens (`MODERATION_CONFIG.reasons`), not
   * free text, mapped to a phrase at render (`quoteFor` -> `removalPhraseFor`) rather than printed
   * raw. `leagueName` is carried because a chat removal, unlike a review's, always has a real
   * league — the message stood in one league's own conversation.
   */
  readonly chat_message_removed: {
    readonly leagueName: string;
    readonly reason: string;
  };
  /**
   * `correctSettledWeek`'s (`@/stats-pipeline/correction`) own notice — Task 10's residual, and
   * the first notice a fully AUTOMATED action sends rather than an operator's own decision. Sent
   * only to a manager whose TEAM's points actually moved as a result of the correction; a manager
   * whose roster the revision never touched hears nothing, because a notice about no change would
   * be noise, not news.
   *
   * `outcome` is one of three FIXED clauses (`StatWeekCorrectionOutcome`), resolved by the caller
   * from the team's before/after result — never free text, so the copy sweep covers every
   * sentence this notice can produce rather than one sample of it. This is the twin of the
   * league-wide `system_action` summary the same correction writes (`SYSTEM_ACTION_SUMMARY_ALLOWED`
   * allows exactly this action, `@/integrity/system-actions`): composed from the same template so
   * the impersonal, league-wide sentence and this personal one can never say different things.
   */
  readonly stat_week_corrected: {
    readonly leagueName: string;
    readonly week: number;
    readonly points: number;
    readonly outcome: StatWeekCorrectionOutcome;
  };
  /**
   * `proposeTrade`'s own notice (`@/league-service/trades`), sent to the counterparty ONLY —
   * `ACTIVITY_VISIBILITY.trade_proposed` is `"hidden"` (ruling 12), so this notice is the entire
   * way the counterparty ever learns an offer exists. `giveSummary`/`getSummary` are pre-rendered
   * English (`Intl.ListFormat`), not raw asset arrays, for the same reason `pickNumber`/
   * `playerName` arrive pre-resolved on `draft_auto_picked`: a template composes a sentence, it
   * does not re-derive one from a payload shape.
   */
  readonly trade_proposed: {
    readonly leagueName: string;
    readonly proposerTeamName: string;
    readonly giveSummary: string;
    readonly getSummary: string;
    /** The proposer's own optional note, capped at `TRADE_CONFIG.noteMaxLength`. Unused by the
     *  TEMPLATE below (which composes the platform's own sentence) but read by `quoteFor`
     *  (`@/integrity-service/notify`) as the counterparty's own bounded blockquote — the same
     *  split `operator_warning`'s `note` and `review_removed`'s `reason` both keep. */
    readonly note: string | null;
  };
  /**
   * `rejectTrade`'s notice, sent to the PROPOSER — the counterparty said no. `ACTIVITY_VISIBILITY
   * .trade_rejected` is `"hidden"`, and more so than a proposal: a refusal is nobody's business
   * but the two people in it.
   */
  readonly trade_rejected: {
    readonly leagueName: string;
    readonly counterpartyTeamName: string;
  };
  /**
   * `withdrawTrade`'s notice, sent to the COUNTERPARTY — the proposer took the offer back.
   * `trade_withdrawn` is a NOTICE type only: `AUDIT_EVENT_TYPES` is frozen (`@/domain/audit`'s
   * own docblock), so the audit event both this and `trade_rejected` come from is spelled
   * `trade_rejected` with `payload.outcome` distinguishing the two — the honest spelling, not a
   * second event type this vocabulary was never going to grow.
   */
  readonly trade_withdrawn: {
    readonly leagueName: string;
    readonly proposerTeamName: string;
  };
  /**
   * `acceptTrade`'s own notice (`@/league-service/trades`), sent to BOTH parties — the one moment
   * this product tells a member their roster just moved. `gaveSummary`/`getSummary` are pre-
   * rendered from THIS recipient's own side of the deal, the same "a template composes a
   * sentence, it does not re-derive one from a payload shape" discipline `trade_proposed` keeps —
   * so the proposer's notice and the counterparty's notice are two calls with the two sides
   * swapped, never one shared object.
   */
  readonly trade_executed: {
    readonly leagueName: string;
    readonly counterpartyTeamName: string;
    readonly gaveSummary: string;
    readonly gotSummary: string;
  };
  /**
   * `acceptTrade`'s supersede sweep (Task 5): sent to the PROPOSER of every OTHER open offer that
   * named a player the accepted trade just moved. `ACTIVITY_VISIBILITY` has no entry for this —
   * it is a notice type only, the same way `trade_withdrawn` is — because "superseded" is a fact
   * about one manager's own dead offer, not league content. Deliberately NOT `trade_rejected`'s
   * copy: nobody declined this offer, and a manager who reads a decline where there wasn't one
   * draws a worse conclusion than the truth (`INTEGRITY_CONFIG.notices.accusatoryTerms`'s whole
   * reason for existing).
   */
  readonly trade_superseded: {
    readonly leagueName: string;
    readonly counterpartyTeamName: string;
  };
}

/**
 * The three, and only three, sentences `stat_week_corrected`'s `outcome` clause may say — resolved
 * by the caller from a team's before/after matchup result, never free text. A closed union rather
 * than a string is what lets `notices.test.ts` sweep every sentence this notice can actually
 * produce (`NOTICE_SAMPLES` carries one; a dedicated test iterates all three) instead of trusting
 * one sample to represent all of them.
 */
export type StatWeekCorrectionOutcome =
  | "your matchup result stays the same"
  | "that turns your matchup into a win"
  | "that turns your matchup into a loss";

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
  // a quote. Fix round 1 (panel HIGH): the last sentence is founder decision #4, the same one
  // `operator_warning` already states — there is no appeal path, and a notice that stays silent
  // about that invites a removed author to go looking for a reply channel that does not exist.
  review_removed: () => ({
    title: "We removed your review",
    body: "An operator removed your review. We keep your review on file exactly as you wrote it. There is no reply to this message.",
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
  // `reason` is stored on the row (`context.reason`) but deliberately unused HERE, the same
  // reason `review_removed`'s own `reason` is: its author-facing phrase travels as its own field
  // on the wire (`quoteFor`), rendered as a distinct blockquote. Unlike a removed review, the
  // room itself already shows that the message went (`RemovedMessage`, `@/chat-room/components`)
  // — this notice tells the author what the room can see, not something new to them. Fix round 1
  // (panel HIGH): the last sentence is the same founder decision #4 `operator_warning` and (this
  // round) `review_removed` both state — there is no appeal path.
  chat_message_removed: ({ leagueName }) => ({
    title: "We removed one of your messages",
    body: `An operator removed a message you posted in ${leagueName}. Your leaguemates can see that the message went and who posted it, and they can no longer read it. We keep your words on file exactly as you wrote them. There is no reply to this message.`,
  }),
  // No "no reply to this message" line, unlike the three removal/warning templates above: this is
  // informational, not a sanction, and there is nothing to appeal. `outcome` is the closed
  // three-clause union (`StatWeekCorrectionOutcome`), never a free string.
  stat_week_corrected: ({ leagueName, week, points, outcome }) => ({
    title: `We corrected your week ${week} score`,
    body: `Our stats provider revised its numbers for week ${week}, so we recomputed ${leagueName}. Your team now has ${points} points, and ${outcome}.`,
  }),
  trade_proposed: ({ leagueName, proposerTeamName, giveSummary, getSummary }) => ({
    title: `${proposerTeamName} sent you a trade offer`,
    body: `In ${leagueName}, ${proposerTeamName} offers you ${giveSummary} for ${getSummary}. Open the trade page to see both sides valued, then accept or decline. The offer stands for three days.`,
  }),
  trade_rejected: ({ leagueName, counterpartyTeamName }) => ({
    title: "Your trade offer got a no",
    body: `${counterpartyTeamName} declined the offer you sent in ${leagueName}. You can put together a different package any time.`,
  }),
  trade_withdrawn: ({ leagueName, proposerTeamName }) => ({
    title: "A trade offer came off the table",
    body: `${proposerTeamName} took back the offer they sent you in ${leagueName}. Nothing on your roster changed.`,
  }),
  trade_executed: ({ leagueName, counterpartyTeamName, gaveSummary, gotSummary }) => ({
    title: "Your trade went through",
    body: `You and ${counterpartyTeamName} completed a trade in ${leagueName}. You sent ${gaveSummary} and you got ${gotSummary}. Your lineup for this week already reflects it, so check your starters before kickoff.`,
  }),
  trade_superseded: ({ leagueName, counterpartyTeamName }) => ({
    title: "One of your offers can no longer go through",
    body: `A player in the offer you had out to ${counterpartyTeamName} in ${leagueName} moved to another team, so that offer is off the table. Nobody declined it. You can put together a new one any time.`,
  }),
};

export function renderNotice<T extends NoticeType>(type: T, context: NoticeContexts[T]): RenderedNotice {
  return NOTICE_TEMPLATES[type](context);
}
