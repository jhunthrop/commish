import { describe, expect, it } from "vitest";
import { copyViolations } from "./copy-rules";
import { NOTICE_TEMPLATES, renderNotice, type NoticeType, type StatWeekCorrectionOutcome } from "./notices";
import { NOTICE_SAMPLES } from "./test-support";

const TYPES = Object.keys(NOTICE_TEMPLATES) as readonly NoticeType[];

describe("NOTICE_TEMPLATES", () => {
  it("renders a title and a body for every type this product can send", () => {
    for (const type of TYPES) {
      const notice = renderNotice(type, NOTICE_SAMPLES[type]);
      expect(notice.title).toMatch(/\S/);
      expect(notice.body).toMatch(/\S/);
    }
  });

  /**
   * ONE RULEBOOK, applied here and to the activity feed's headlines by the same function. It used
   * to be two: notice templates got the accusatory, passive and dash sweeps, and activity
   * headlines got the dash sweep alone. `copyViolations` (`./copy-rules`) is the single
   * implementation; `activity-view.test.ts` runs the identical loop over its own surface.
   *
   * `TYPES` is derived from `NOTICE_TEMPLATES`, so a template Plans B, C or D add is swept the
   * day it lands, and a type with no `NOTICE_SAMPLES` entry does not compile.
   */
  it("breaks none of the house copy rules, for any type this product can send", () => {
    for (const type of TYPES) {
      const { title, body } = renderNotice(type, NOTICE_SAMPLES[type]);
      expect(copyViolations(`${title} ${body}`)).toEqual([]);
    }
  });

  it("says what happened and what it means, in the second person, without jargon", () => {
    const autoPick = renderNotice("draft_auto_picked", NOTICE_SAMPLES.draft_auto_picked);
    expect(autoPick.title).toBe("We made your pick for you");
    expect(autoPick.body).toBe(
      "The clock ran out on pick 24 in Sunday Money, so we used your queue and drafted Bijan Robinson (RB). Set your queue before your next draft so this doesn't happen again.",
    );

    const removed = renderNotice("review_removed", NOTICE_SAMPLES.review_removed);
    expect(removed.title).toBe("We removed your review");
    // Fix round 1 (panel HIGH): states there is no appeal, the same founder decision #4
    // `operator_warning` already stated and this notice was missing.
    expect(removed.body).toBe("An operator removed your review. We keep your review on file exactly as you wrote it. There is no reply to this message.");

    const granted = renderNotice("admin_granted", NOTICE_SAMPLES.admin_granted);
    expect(granted.title).toBe("You can now use the operator tools");
    expect(granted.body).toBe(
      "Someone with database access turned on operator access for your account. You can open the dispute queue from your account menu. Every decision you record there carries your name and cannot be taken back.",
    );

    // The operator's own `note` is deliberately absent from `body` here — it renders as its own
    // blockquote (`quoteFor`), not folded into the platform's sentence.
    const warned = renderNotice("operator_warning", NOTICE_SAMPLES.operator_warning);
    expect(warned.title).toBe("An operator left you a note");
    expect(warned.body).toBe(
      "Somebody reported something you posted in Sunday Money. An operator read it, decided to leave your post up, and wrote you this note. There is no reply to this message.",
    );
    expect(warned.body).not.toContain("Keep the trash talk");

    // The chat sibling of `review_removed`, mirroring it field for field: the reason is
    // deliberately absent from `body` here too — it renders as its own blockquote (`quoteFor`).
    const chatRemoved = renderNotice("chat_message_removed", NOTICE_SAMPLES.chat_message_removed);
    expect(chatRemoved.title).toBe("We removed one of your messages");
    // Fix round 1 (panel HIGH): same no-appeal sentence as `review_removed` now states.
    expect(chatRemoved.body).toBe(
      "An operator removed a message you posted in Sunday Money. Your leaguemates can see that the message went and who posted it, and they can no longer read it. We keep your words on file exactly as you wrote them. There is no reply to this message.",
    );
    expect(chatRemoved.body).not.toContain("off topic");
  });

  it("says what happened for each of the three trade notices, verbatim", () => {
    const proposed = renderNotice("trade_proposed", NOTICE_SAMPLES.trade_proposed);
    expect(proposed.title).toBe("Bay Bandits sent you a trade offer");
    expect(proposed.body).toBe(
      "In Sunday Money, Bay Bandits offers you Bijan Robinson for Justin Jefferson. Open the trade page to see both sides valued, then accept or decline. The offer stands for three days.",
    );

    const rejected = renderNotice("trade_rejected", NOTICE_SAMPLES.trade_rejected);
    expect(rejected.title).toBe("Your trade offer got a no");
    expect(rejected.body).toBe("Iron Owls declined the offer you sent in Sunday Money. You can put together a different package any time.");

    const withdrawn = renderNotice("trade_withdrawn", NOTICE_SAMPLES.trade_withdrawn);
    expect(withdrawn.title).toBe("A trade offer came off the table");
    expect(withdrawn.body).toBe("Bay Bandits took back the offer they sent you in Sunday Money. Nothing on your roster changed.");
  });

  it("says what happened for the two acceptance-time trade notices, verbatim", () => {
    const executed = renderNotice("trade_executed", NOTICE_SAMPLES.trade_executed);
    expect(executed.title).toBe("Your trade went through");
    expect(executed.body).toBe(
      "You and Iron Owls completed a trade in Sunday Money. You sent Bijan Robinson and you got Justin Jefferson. Your lineup for this week already reflects it, so check your starters before kickoff.",
    );

    const superseded = renderNotice("trade_superseded", NOTICE_SAMPLES.trade_superseded);
    expect(superseded.title).toBe("One of your offers can no longer go through");
    expect(superseded.body).toBe(
      "A player in the offer you had out to Iron Owls in Sunday Money moved to another team, so that offer is off the table. Nobody declined it. You can put together a new one any time.",
    );

    // Final review, LOW 9: the manager who RECEIVED the doomed offer is told too, in the sentence
    // for their own side — it came in rather than went out, and their roster did not move.
    const supersededForRecipient = renderNotice("trade_superseded", { ...NOTICE_SAMPLES.trade_superseded, role: "counterparty" });
    expect(supersededForRecipient.title).toBe("An offer waiting on you can no longer go through");
    expect(supersededForRecipient.body).toBe(
      "A player in the offer Iron Owls sent you in Sunday Money moved to another team, so that offer is off the table. Nobody declined it, and nothing on your roster changed. Ask them for a fresh one any time.",
    );
    // "Nobody declined it" is the whole point of this template: a manager who sees an offer die
    // must not read it as a refusal.
    expect(superseded.body).toContain("Nobody declined it");
  });

  it("says what happened when an operator reverses a trade, verbatim (Task 7, fix round 2 F2 naming)", () => {
    const reversed = renderNotice("trade_reversed", NOTICE_SAMPLES.trade_reversed);
    expect(reversed.title).toBe("An operator reversed your trade");
    expect(reversed.body).toBe(
      "An operator reversed the trade you and Iron Owls completed in Sunday Money. You have Bijan Robinson again, and Iron Owls has Justin Jefferson. Scores from weeks you have already played stay as they were. There is no reply to this message.",
    );
    // The operator's own note is deliberately absent from `body` — it renders as its own
    // blockquote (`quoteFor`), the same split every other quoting template keeps.
    expect(reversed.body).not.toContain("household");
    // Founder decision #4: this is a moderation consequence, and the notice says there is no
    // appeal path rather than leaving a reversed-on manager to go hunting for one.
    expect(reversed.body).toContain("There is no reply to this message.");
  });

  it("says what happened when a join is refused for tier segregation, verbatim (Task 3)", () => {
    const blocked = renderNotice("tier_blocked_join", NOTICE_SAMPLES.tier_blocked_join);
    expect(blocked.title).toBe("That league is reserved for newer players");
    expect(blocked.body).toBe(
      "You asked to join Rookie Snake Room, which keeps its seats for players who are new to Commish so everyone starts on a level footing. Plenty of leagues are open to everyone, and the browse page lists the ones with seats left right now.",
    );
    // Not a sanction — nothing about this member's own conduct, and no "no reply" line: there is
    // nothing to appeal, only a rule about the league they asked to join.
    expect(blocked.body).not.toContain("There is no reply to this message.");
  });

  it("says what happened when a trade is held for a fairness review, verbatim (Plan D, Task 5)", () => {
    const held = renderNotice("trade_held_for_review", NOTICE_SAMPLES.trade_held_for_review);
    expect(held.title).toBe("Your trade is waiting on a fairness review");
    expect(held.body).toBe(
      "Your trade with Iron Owls in Sunday Money is on hold while somebody at Commish looks at it. Public leagues get a second pair of eyes on trades this lopsided, and neither roster changes until that finishes. We will tell you both as soon as there is an answer.",
    );
    // Founder decision #10's own words: "somebody at Commish looks at it", never "under
    // investigation"; "this lopsided", never "suspicious" — the accusatory-terms denylist would
    // catch the latter, but the WORDS matter beyond what the denylist happens to enforce.
    expect(held.body).not.toContain("investigation");
    expect(held.body).not.toContain("suspicious");
  });

  it("says what happened when an operator blocks a held trade, verbatim (Plan D, Task 5)", () => {
    const blocked = renderNotice("trade_blocked", NOTICE_SAMPLES.trade_blocked);
    expect(blocked.title).toBe("Your trade will not go through");
    expect(blocked.body).toBe(
      "After the fairness review, your trade in Sunday Money will not go ahead, and both rosters stay exactly as they were. You can put together a different offer any time.",
    );
    // Not a sanction against either named manager, so — unlike trade_reversed's own note — no
    // "no reply to this message" line: neither party is accused of anything, only told a rule
    // this trade ran into.
    expect(blocked.body).not.toContain("There is no reply to this message.");
    // No counterparty name either — deliberately, so the SAME body reaches both managers
    // byte-identical (`resolveFlag`'s own `trade_blocked` branch sends this exact context to
    // both), never a sentence that names "the other manager" and therefore differs by recipient.
    expect(blocked.body).not.toContain("Iron Owls");
  });

  it("says what happened when a draft auto-starts, verbatim (Plan D, Task 7)", () => {
    const started = renderNotice("draft_auto_started", NOTICE_SAMPLES.draft_auto_started);
    expect(started.title).toBe("Your draft in Sunday Money has started");
    expect(started.body).toBe(
      "The draft reached its scheduled time, so we started it. Head to the draft room now, or let the clock queue your picks if you cannot make it. We will tell you when it is your turn.",
    );
    // Not a sanction — nothing about any member's own conduct, so no "no reply" line.
    expect(started.body).not.toContain("There is no reply to this message.");
  });

  it("says what happened when a pick is skipped instead of penalized, verbatim (Task 5, Phase 3.5)", () => {
    const skipped = renderNotice("draft_pick_skipped", NOTICE_SAMPLES.draft_pick_skipped);
    expect(skipped.title).toBe("Your pick passed in Sunday Money");
    expect(skipped.body).toBe("Your pick passed while you were away. You can still make it, and the draft will wait for it before it finishes.");
    // A courtesy, not a sanction: nothing about this manager's own conduct to appeal.
    expect(skipped.body).not.toContain("There is no reply to this message.");
    // The whole point of a skip is that the pick is still theirs — never "missed", the same
    // failure mode `lineup_auto_set`'s own copy avoids.
    expect(skipped.body).not.toContain("missed");
  });

  it("fails the type checker rather than the reader when a type has no template", () => {
    // NOTICE_TEMPLATES is a Record over the full union, so adding a NoticeType without adding
    // its copy does not compile. Asserted here too so the property is visible in the suite.
    expect([...TYPES].sort()).toEqual([
      "admin_granted",
      "chat_message_removed",
      "draft_auto_picked",
      "draft_auto_started",
      "draft_pick_skipped",
      "lineup_auto_set",
      "operator_warning",
      "review_removed",
      "stat_week_corrected",
      "tier_blocked_join",
      "trade_blocked",
      "trade_executed",
      "trade_held_for_review",
      "trade_proposed",
      "trade_rejected",
      "trade_reversed",
      "trade_superseded",
      "trade_withdrawn",
    ]);
  });

  /**
   * Task 10's own requirement, extended by Phase 3.5 Task 2's fix round 1 (F1): `outcome` is a
   * closed union, never a free string, so this notice's copy sweep covers every sentence it can
   * actually produce rather than the one sample `NOTICE_SAMPLES` carries — the original three
   * matchup-only clauses, and the nine median-aware ones that name both games' movement.
   */
  it("says what happened for every one of the twelve fixed outcome clauses, all copy-clean", () => {
    const outcomes: readonly StatWeekCorrectionOutcome[] = [
      "your matchup result stays the same",
      "that turns your matchup into a win",
      "that turns your matchup into a loss",
      "your matchup result stays the same, and so does your median result",
      "your matchup result stays the same, but that turns your median result into a win",
      "your matchup result stays the same, but that turns your median result into a loss",
      "that turns your matchup into a win, but your median result stays the same",
      "that turns your matchup into a win, and that also turns your median result into a win",
      "that turns your matchup into a win, but that turns your median result into a loss",
      "that turns your matchup into a loss, but your median result stays the same",
      "that turns your matchup into a loss, but that turns your median result into a win",
      "that turns your matchup into a loss, and that also turns your median result into a loss",
    ];
    for (const outcome of outcomes) {
      const notice = renderNotice("stat_week_corrected", { leagueName: "Sunday Money", week: 3, points: 84.2, outcome });
      expect(notice.title).toBe("We corrected your week 3 score");
      expect(notice.body).toBe(
        `Our stats provider revised its numbers for week 3, so we recomputed Sunday Money. Your team now has 84.2 points, and ${outcome}.`,
      );
      expect(copyViolations(`${notice.title} ${notice.body}`)).toEqual([]);
    }
  });

  it("is informational, not a sanction, so it states no appeal path the way removal notices do", () => {
    const notice = renderNotice("stat_week_corrected", NOTICE_SAMPLES.stat_week_corrected);
    expect(notice.body).not.toContain("There is no reply to this message.");
  });

  /**
   * Task 4, Step 6: says what happened and which week it copied, ends on what the manager
   * controls, and never uses the word "missed" — the failure mode a sentence opening with what
   * somebody failed to do would be, even where the denylist itself would pass either word.
   */
  it("says what happened when a lineup is auto-set, verbatim, with no changed-players clause", () => {
    const notice = renderNotice("lineup_auto_set", NOTICE_SAMPLES.lineup_auto_set);
    expect(notice.title).toBe("We set your week 4 lineup for you");
    expect(notice.body).toBe(
      "Week 4 kicked off in Sunday Money before you set a lineup, so we started the same team you started in week 3. You can set your own lineup any week before kickoff, and we will leave it alone when you do.",
    );
    expect(notice.body).not.toContain("missed");
    expect(notice.body).not.toContain("There is no reply to this message.");
  });

  it("folds a non-empty changedPlayers clause into the sentence right after the carried-from week, still copy-clean", () => {
    const withOneChange = renderNotice("lineup_auto_set", {
      ...NOTICE_SAMPLES.lineup_auto_set,
      changedPlayers: " Christian McCaffrey is no longer on your roster, so we filled that spot from your bench.",
    });
    expect(withOneChange.body).toBe(
      "Week 4 kicked off in Sunday Money before you set a lineup, so we started the same team you started in week 3. Christian McCaffrey is no longer on your roster, so we filled that spot from your bench. You can set your own lineup any week before kickoff, and we will leave it alone when you do.",
    );
    expect(copyViolations(`${withOneChange.title} ${withOneChange.body}`)).toEqual([]);
  });
});
