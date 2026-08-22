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
   * `acceptTrade`'s supersede sweep (Task 5): sent to BOTH parties of every OTHER open offer that
   * named a player the accepted trade just moved. `ACTIVITY_VISIBILITY` has no entry for this —
   * it is a notice type only, the same way `trade_withdrawn` is — because "superseded" is a fact
   * about one dead offer, not league content. Deliberately NOT `trade_rejected`'s copy: nobody
   * declined this offer, and a manager who reads a decline where there wasn't one draws a worse
   * conclusion than the truth (`INTEGRITY_CONFIG.notices.accusatoryTerms`'s whole reason for
   * existing).
   *
   * BOTH PARTIES, from the final review's LOW 9: this used to tell only the doomed PROPOSER. The
   * counterparty had that offer sitting in their inbox awaiting an answer, and something changed
   * under them — the card simply vanished on the next refetch, with no word. Every other
   * two-party trade notice in this file (`trade_executed`, `trade_reversed`) already tells both,
   * and the asymmetry was undocumented rather than decided.
   *
   * `role` is what the two sentences differ on, and the only thing: the proposer's offer went out,
   * the counterparty's came in. `counterpartyTeamName` is always the OTHER manager from this
   * recipient's own point of view, the same "pre-rendered per recipient" shape `trade_reversed`
   * uses.
   */
  readonly trade_superseded: {
    readonly leagueName: string;
    readonly counterpartyTeamName: string;
    readonly role: "proposer" | "counterparty";
  };
  /**
   * `reverseTradeInTx`'s own notice (`@/league-service/trade-reversal`, Task 7), sent to BOTH
   * parties — the one decision in this product that changes two rosters on nobody's own request,
   * so both people are affected and both read the identical words (the product never signals which
   * of the two was the one under suspicion). `gotBackSummary`/`gaveBackSummary` are pre-rendered
   * from THIS recipient's own side, the same "a template composes a sentence" discipline
   * `trade_executed` keeps. `note` is the OPERATOR's own words, carried the same way
   * `operator_warning`'s `note` is — unused by the template below, read by `quoteFor` instead.
   */
  readonly trade_reversed: {
    readonly leagueName: string;
    readonly counterpartyTeamName: string;
    readonly gotBackSummary: string;
    readonly gaveBackSummary: string;
    readonly note: string;
  };
  /**
   * `recordTierBlockedJoin`'s own notice (`@/league-service/join`, Task 3) — the join-side half of
   * the enforcement predicate in `@/league-service/enforcement`. Sent to the member who was turned
   * away, and to nobody else: `SYSTEM_ACTION_VISIBILITY`'s (`@/integrity/system-actions`) entry for
   * `tier_blocked_join` is `hidden`, because nobody else in the league needs to know a stranger was
   * refused at the door, and telling them would publish a stranger's inexperience to twelve people
   * who never met them. `leagueName` is the only context this notice carries — no mention of WHY
   * the account was refused (no completed-season count, no tier label): the no-oracle discipline
   * that keeps a private league's existence unconfirmed applies here too, one level down — this
   * notice explains what happened, not a scorecard of the account that triggered it.
   */
  readonly tier_blocked_join: {
    readonly leagueName: string;
  };
  /**
   * `autoSetLineupInTx`'s own notice (`@/league-service/auto-lineup`, Task 4) — the personal half
   * of the `lineup_auto_set` `system_action` the same write appends (`SYSTEM_ACTION_VISIBILITY`
   * is `"subject_only"` for it, `@/integrity/system-actions`), sent only to the manager whose
   * lineup was set. `carriedFrom` is the week whose saved choice was copied forward
   * (`MISSED_DEADLINE_LINEUP_STRATEGY`'s `repeat_previous_week`, the only strategy this plan
   * declares) — always a real earlier week, because the one week with no earlier week to copy
   * (a league's first) is a materialization of the roster's own default rather than a copy of a
   * choice, and that case sends no notice at all (nothing was carried forward to report).
   *
   * `changedPlayers` is a rendered clause from a FIXED set (nothing changed; one player named;
   * several named), produced by `changedPlayersClauseFor` — never free text, so `notices.test.ts`
   * sweeps every sentence this notice can produce rather than one sample of it, the discipline
   * `correctionOutcome` established in Plan B.
   */
  readonly lineup_auto_set: {
    readonly leagueName: string;
    readonly week: number;
    readonly carriedFrom: number;
    readonly changedPlayers: string;
  };
  /**
   * `acceptTrade`'s own notice for its hold branch (`@/league-service/trades`, Plan D Task 5),
   * sent to BOTH parties inside the SAME platform-scoped transaction that raises the `trade_hold`
   * flag — never after commit, because nothing about a hold is league news (ruling 12). Deliberately
   * not "under review" or "suspicious": founder decision #10 as shipped asks for "somebody at
   * Commish looks at it" and "this lopsided" so the held-trade banner on the trades page
   * (`held-trade-banner.tsx`) can say the identical sentence a member reads here, and a member who
   * read two different sentences about one fact would read one of them as a euphemism.
   */
  readonly trade_held_for_review: {
    readonly leagueName: string;
    readonly counterpartyTeamName: string;
  };
  /**
   * `resolveFlag`'s `trade_blocked` decision (`@/integrity-service/flags`, Plan D Task 5), sent to
   * BOTH parties, BYTE-IDENTICAL — deliberately WITHOUT a `counterpartyTeamName` the way
   * `trade_executed`/`trade_reversed` both carry one, because "your trade with X" reads as a
   * different sentence to each side (X is the OTHER manager, so the two recipients' own sentences
   * would differ by exactly the one word that makes them provably the same notice). Neither
   * manager is told which of them, if either, the review was actually about — the same "the
   * product never signals which of the two was under suspicion" discipline `trade_reversed`
   * already keeps, held to more strictly here. `note` is the OPERATOR's own words, carried the
   * same way `trade_reversed`'s `note` is — unused by the template below, read by `quoteFor`
   * (`@/integrity-service/notify`) instead, and bound by `NOTE_REACHES_SOMEONE_ELSE.trade_blocked`
   * (`@/integrity-service/flags`) being `true`: this note reaches two real people, so the
   * accusatory-language guard runs on it exactly as it runs on `trade_reversed`'s own.
   */
  readonly trade_blocked: {
    readonly leagueName: string;
    readonly note: string;
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
  trade_superseded: ({ leagueName, counterpartyTeamName, role }) =>
    role === "proposer"
      ? {
          title: "One of your offers can no longer go through",
          body: `A player in the offer you had out to ${counterpartyTeamName} in ${leagueName} moved to another team, so that offer is off the table. Nobody declined it. You can put together a new one any time.`,
        }
      : {
          title: "An offer waiting on you can no longer go through",
          body: `A player in the offer ${counterpartyTeamName} sent you in ${leagueName} moved to another team, so that offer is off the table. Nobody declined it, and nothing on your roster changed. Ask them for a fresh one any time.`,
        },
  // `note` is stored on the row (`context.note`) but deliberately unused HERE, the same reason
  // every other quoting template's own field is: the operator's own words travel as their own
  // field on the wire (`quoteFor`), rendered as a distinct blockquote. The last sentence is the
  // same founder decision #4 every other sanction-shaped notice in this file states: there is no
  // appeal path, and this decision is a moderation consequence, so silence about that would invite
  // a member to go looking for a reply channel that does not exist.
  //
  // Fix round 2 (F2, naming consistency): the action is named "reversed" here, in the title AND
  // the body's own opening clause — never "put back", which used to be the only verb the title
  // gave a member, splitting from the decision label, the trail row and the already-reversed
  // note elsewhere on this same flag. "You have X again, and Y has Z" stays as the one place this
  // notice is allowed to describe the CONSEQUENCE in its own words, per the same rule: an effect
  // phrase may explain what a decision did, in body copy, but must never stand in for the
  // decision's own name.
  trade_reversed: ({ leagueName, counterpartyTeamName, gotBackSummary, gaveBackSummary }) => ({
    title: "An operator reversed your trade",
    body: `An operator reversed the trade you and ${counterpartyTeamName} completed in ${leagueName}. You have ${gotBackSummary} again, and ${counterpartyTeamName} has ${gaveBackSummary}. Scores from weeks you have already played stay as they were. There is no reply to this message.`,
  }),
  // No "no reply to this message" line: this is not a sanction and there is nothing about the
  // member's own conduct to appeal — it explains a rule about the LEAGUE, not a decision about
  // the person. Deliberately does not name the account's own completed-season count or tier: the
  // no-oracle discipline that keeps a private league's existence unconfirmed to a stranger applies
  // here too, one level down — the notice says what happened, not a scorecard of why.
  tier_blocked_join: ({ leagueName }) => ({
    title: "That league is reserved for newer players",
    body: `You asked to join ${leagueName}, which keeps its seats for players who are new to Commish so everyone starts on a level footing. Plenty of leagues are open to everyone, and the browse page lists the ones with seats left right now.`,
  }),
  // Three properties, each deliberate (Task 4, Step 6). It says what the platform did and which
  // week it copied, so the manager can check it. It ends with the thing they control, because a
  // notice about something they did not choose should close on something they can. And it never
  // uses the word "missed": a sentence that opens with what somebody failed to do is the failure
  // mode `INTEGRITY_CONFIG.notices.accusatoryTerms` exists to approximate, even where the
  // denylist itself would pass either word. No "no reply to this message" line: this is not a
  // sanction, and there is nothing about the member's own conduct to appeal.
  lineup_auto_set: ({ leagueName, week, carriedFrom, changedPlayers }) => ({
    title: `We set your week ${week} lineup for you`,
    body: `Week ${week} kicked off in ${leagueName} before you set a lineup, so we started the same team you started in week ${carriedFrom}.${changedPlayers} You can set your own lineup any week before kickoff, and we will leave it alone when you do.`,
  }),
  // Founder decision #10's own words, verbatim (Task 5's brief): "somebody at Commish looks at
  // it" rather than "is under investigation", "this lopsided" rather than "suspicious". No "no
  // reply to this message" line: this is not a sanction, there is nothing about either member's
  // own conduct to appeal, and the review is still open — closing that door here would be
  // premature. `held-trade-banner.tsx` says the identical sentence.
  trade_held_for_review: ({ leagueName, counterpartyTeamName }) => ({
    title: "Your trade is waiting on a fairness review",
    body: `Your trade with ${counterpartyTeamName} in ${leagueName} is on hold while somebody at Commish looks at it. Public leagues get a second pair of eyes on trades this lopsided, and neither roster changes until that finishes. We will tell you both as soon as there is an answer.`,
  }),
  // The same founder decision #4 every other sanction-adjacent notice in this file states: there
  // is no appeal path. Deliberately no "no reply to this message" line, though — a blocked trade
  // is not a sanction against either manager (`resolveFlag`'s own `NOTE_REACHES_SOMEONE_ELSE`
  // guard still runs on the operator's note, the same accusatory-language check `trade_reversed`'s
  // note already passes through), and both sentences below already say what a member needs: it
  // will not go through, and they are free to try again.
  trade_blocked: ({ leagueName }) => ({
    title: "Your trade will not go through",
    body: `After the fairness review, your trade in ${leagueName} will not go ahead, and both rosters stay exactly as they were. You can put together a different offer any time.`,
  }),
};

export function renderNotice<T extends NoticeType>(type: T, context: NoticeContexts[T]): RenderedNotice {
  return NOTICE_TEMPLATES[type](context);
}
