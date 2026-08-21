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

  it("fails the type checker rather than the reader when a type has no template", () => {
    // NOTICE_TEMPLATES is a Record over the full union, so adding a NoticeType without adding
    // its copy does not compile. Asserted here too so the property is visible in the suite.
    expect([...TYPES].sort()).toEqual([
      "admin_granted",
      "chat_message_removed",
      "draft_auto_picked",
      "operator_warning",
      "review_removed",
      "stat_week_corrected",
      "trade_executed",
      "trade_proposed",
      "trade_rejected",
      "trade_reversed",
      "trade_superseded",
      "trade_withdrawn",
    ]);
  });

  /**
   * Task 10's own requirement: `outcome` is a closed three-clause union, never a free string, so
   * this notice's copy sweep covers every sentence it can actually produce rather than the one
   * sample `NOTICE_SAMPLES` carries.
   */
  it("says what happened for every one of the three fixed outcome clauses, all copy-clean", () => {
    const outcomes: readonly StatWeekCorrectionOutcome[] = [
      "your matchup result stays the same",
      "that turns your matchup into a win",
      "that turns your matchup into a loss",
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
});
