import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { NoticesProvider } from "@/components/app-shell/notices-provider";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";

vi.mock("@/lib/auth/current-user", () => ({ requireAdmin: vi.fn() }));
vi.mock("@research-ts/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/integrity-service/flags", () => ({ flagDetail: vi.fn() }));
vi.mock("@/draft-service/teams", () => ({ leagueNameFor: vi.fn() }));

// `ResolutionForm` (`src/admin-room/components/resolution-form.tsx`) calls `useRouter()` for its
// post-submit `router.refresh()` — real `next/navigation`'s `notFound()` needs no request
// context (it is a plain synchronous throw), but `useRouter()` does, so it is the one export
// this file mocks rather than importing wholesale.
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) };
});

import { requireAdmin } from "@/lib/auth/current-user";
import { flagDetail } from "@/integrity-service/flags";
import { leagueNameFor } from "@/draft-service/teams";
import AdminFlagDetailPage from "./page";

const OPERATOR = { id: "u_op", email: "u_op@test.local", displayName: "Op Erator", experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-01T00:00:00.000Z", isAdmin: true };

const OPEN_REVIEW_DETAIL = {
  flagId: "flag_1",
  flagType: "review_report" as const,
  raisedAt: "2026-08-01T00:00:00.000Z",
  leagueId: null,
  subject: { kind: "review" as const, reviewId: "r1", body: "Great season overall.", authorName: "Ada", removedAt: null },
  evidence: {},
  reporters: [{ userId: "u_reporter", name: "Reporter", reason: "spam", reportedAt: "2026-08-01T00:00:01.000Z" }],
  trail: [{ eventId: "evt_1", occurredAt: "2026-08-01T00:00:00.000Z", icon: "alert-triangle" as const, headline: "This flag was opened.", detail: null }],
  resolution: null,
  decisions: ["no_action", "warned_user", "content_removed"] as const,
};

function callPage(flagId = "flag_1") {
  return AdminFlagDetailPage({ params: Promise.resolve({ flagId }) });
}

async function renderPage(flagId?: string) {
  const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
  const page = await callPage(flagId);
  return render(
    <AccountRoomDepsProvider deps={fixture.deps}>
      <NoticesProvider>{page}</NoticesProvider>
    </AccountRoomDepsProvider>,
  );
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset().mockResolvedValue(OPERATOR);
  vi.mocked(flagDetail).mockReset();
  vi.mocked(leagueNameFor).mockReset().mockResolvedValue("Sunday Money");
});

describe("AdminFlagDetailPage — the gate and the non-oracle 404", () => {
  it("404s a signed-in non-operator, never 403", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not an operator."));
    await expect(callPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(vi.mocked(flagDetail)).not.toHaveBeenCalled();
  });

  it("404s a flag id that names nothing, the same as a non-operator would get", async () => {
    vi.mocked(flagDetail).mockResolvedValue(null);
    await expect(callPage("flag_ghost")).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});

describe("AdminFlagDetailPage — the read", () => {
  it("renders the subject, reporters, trail and a decision form for an open flag, in both themes, axe-clean", async () => {
    vi.mocked(flagDetail).mockResolvedValue(OPEN_REVIEW_DETAIL);
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    const page = await callPage();
    await renderSurface(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <NoticesProvider>{page}</NoticesProvider>
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        expect(await screen.findByText("Great season overall.")).toBeInTheDocument();
        expect(screen.getByText("By Ada")).toBeInTheDocument();
        expect(screen.getByText(/reported .spam. on/)).toBeInTheDocument();
        expect(screen.getByText("This flag was opened.")).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "No action" })).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "Warn the member" })).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "Remove the content" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("offers content removal for a chat message too — Task 6's chat branch is wired", async () => {
    vi.mocked(flagDetail).mockResolvedValue({
      ...OPEN_REVIEW_DETAIL,
      leagueId: "l1",
      subject: { kind: "chat_message" as const, messageId: "5", body: "trash talk", authorName: "Bob", removedAt: null },
    });
    await renderPage();

    expect(await screen.findByRole("radio", { name: "No action" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Remove the content" })).toBeInTheDocument();
  });

  it("previews the chat notice, not the review one, when removing a chat message", async () => {
    vi.mocked(flagDetail).mockResolvedValue({
      ...OPEN_REVIEW_DETAIL,
      leagueId: "l1",
      subject: { kind: "chat_message" as const, messageId: "5", body: "trash talk", authorName: "Bob", removedAt: null },
    });
    await renderPage();

    screen.getByRole("radio", { name: "Remove the content" }).click();
    expect(await screen.findByText("We removed one of your messages")).toBeInTheDocument();
    expect(screen.queryByText("We removed your review")).not.toBeInTheDocument();
  });

  /**
   * Final review, MEDIUM 8. `reportMessage`/`reportReview` check existence and league, never
   * `removed_at IS NULL`, and the open-subject unique index only dedupes OPEN flags — so a member
   * CAN report a tombstoned message and open a fresh flag on it. Both of those are correct: a
   * fresh report on removed content is a real question and `warned_user` is a real answer to it,
   * so the flag is not auto-resolved. What was wrong is that this page then offered
   * `content_removed`, which `removeChatMessageInTx`'s no-re-stamp guard refuses with a 409 and a
   * full rollback, leaving the flag permanently unresolvable by the decision the page offered.
   */
  it("withholds content removal for a message that is already removed, and says so on the card", async () => {
    vi.mocked(flagDetail).mockResolvedValue({
      ...OPEN_REVIEW_DETAIL,
      leagueId: "l1",
      subject: { kind: "chat_message" as const, messageId: "5", body: "trash talk", authorName: "Bob", removedAt: "2026-08-02T00:00:00.000Z" },
    });
    await renderPage();

    expect(await screen.findByRole("radio", { name: "No action" })).toBeInTheDocument();
    // The two decisions that still work are still offered — an operator may absolutely warn the
    // author of content that is already gone.
    expect(screen.getByRole("radio", { name: "Warn the member" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Remove the content" })).not.toBeInTheDocument();
    expect(screen.getByText(/We already removed this content/)).toBeInTheDocument();
    // And the words are still readable, because the operator cannot judge whether to warn without
    // them. A removed row keeps its body; only the member-facing wire withholds it.
    expect(screen.getByText("trash talk")).toBeInTheDocument();
  });

  it("withholds content removal for a review that is already removed too", async () => {
    vi.mocked(flagDetail).mockResolvedValue({
      ...OPEN_REVIEW_DETAIL,
      subject: { ...OPEN_REVIEW_DETAIL.subject, removedAt: "2026-08-02T00:00:00.000Z" },
    });
    await renderPage();

    expect(await screen.findByRole("radio", { name: "No action" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Remove the content" })).not.toBeInTheDocument();
    expect(screen.getByText(/We already removed this content/)).toBeInTheDocument();
  });

  it("says nothing about a removal on content that still stands", async () => {
    vi.mocked(flagDetail).mockResolvedValue(OPEN_REVIEW_DETAIL);
    await renderPage();

    expect(await screen.findByRole("radio", { name: "Remove the content" })).toBeInTheDocument();
    expect(screen.queryByText(/We already removed this content/)).not.toBeInTheDocument();
  });

  it("offers no content-removal decision for an account pair — no remover exists for it", async () => {
    vi.mocked(flagDetail).mockResolvedValue({
      ...OPEN_REVIEW_DETAIL,
      subject: { kind: "account_pair" as const, userIds: ["u_a", "u_b"] as const, names: ["Alex", "Sam"] as const },
    });
    await renderPage();

    expect(await screen.findByRole("radio", { name: "No action" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Remove the content" })).not.toBeInTheDocument();
  });

  const TRADE_SUBJECT = {
    kind: "trade" as const,
    tradeId: "trade_1",
    proposerTeamName: "Team Alice",
    counterpartyTeamName: "Team Bob",
    gave: [{ playerId: "p1", name: "Star RB", position: "RB" as const, averagePoints: 22.4 }],
    got: [{ playerId: "p2", name: "Bench WR", position: "WR" as const, averagePoints: 3.1 }],
    acceptedAt: "2026-08-10T00:00:00.000Z",
    reversedAt: null,
    valuationBasis: "The platform valued this trade the moment it was accepted.",
    fairnessGapSummary: "The two sides differ by 22.4 points per week, at or past the 20-point threshold that raised this flag.",
    playersMovedAgain: false,
  };

  describe("the trade subject arm (Task 7)", () => {
    it("renders both teams, both sides valued, when it was accepted, the valuation basis, and the fairness gap (fix round 2, F3), in both themes, axe-clean", async () => {
      vi.mocked(flagDetail).mockResolvedValue({
        ...OPEN_REVIEW_DETAIL,
        leagueId: "l1",
        subject: TRADE_SUBJECT,
        decisions: ["no_action", "warned_user", "trade_reversed"],
      });
      const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
      const page = await callPage();
      await renderSurface(
        <AccountRoomDepsProvider deps={fixture.deps}>
          <NoticesProvider>{page}</NoticesProvider>
        </AccountRoomDepsProvider>,
        async ({ container }) => {
          expect(await screen.findByText("Team Alice and Team Bob")).toBeInTheDocument();
          expect(screen.getByText(/Star RB \(RB\), 22.4 points per week/)).toBeInTheDocument();
          expect(screen.getByText(/Bench WR \(WR\), 3.1 points per week/)).toBeInTheDocument();
          expect(screen.getByText(/The platform valued this trade the moment it was accepted\./)).toBeInTheDocument();
          expect(screen.getByText(/The two sides differ by 22\.4 points per week, at or past the 20-point threshold/)).toBeInTheDocument();
          expect(screen.getByRole("radio", { name: "Reverse the trade" })).toBeInTheDocument();
          expect(screen.queryByRole("radio", { name: "Remove the content" })).not.toBeInTheDocument();
          expect(await axe(container)).toHaveNoViolations();
        },
      );
    });

    it("says a trade has already been reversed, and withholds the reversal decision, once reversedAt is set (fix round 2, F2 naming)", async () => {
      vi.mocked(flagDetail).mockResolvedValue({
        ...OPEN_REVIEW_DETAIL,
        leagueId: "l1",
        subject: { ...TRADE_SUBJECT, reversedAt: "2026-08-15T00:00:00.000Z" },
        decisions: ["no_action", "warned_user"],
      });
      await renderPage();

      expect(await screen.findByText(/An operator already reversed this trade/)).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "Reverse the trade" })).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "No action" })).toBeInTheDocument();
    });

    it("never offers a trade reversal on a non-trade subject (the SUBJECT-narrowed decisions from flagDetail)", async () => {
      vi.mocked(flagDetail).mockResolvedValue(OPEN_REVIEW_DETAIL); // a review, decisions from the fixture
      await renderPage();

      expect(await screen.findByRole("radio", { name: "No action" })).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "Reverse the trade" })).not.toBeInTheDocument();
    });

    /**
     * Fix round 1 (LOW, M8 discipline). The moved-again refusal now previews BEFORE the click,
     * not just as a 409 on submit — `playersMovedAgain` withholds the decision and the card says
     * why, the same pattern the already-reversed state just above already established.
     */
    it("says a traded player has moved on since, and withholds the reversal decision, once playersMovedAgain is set", async () => {
      vi.mocked(flagDetail).mockResolvedValue({
        ...OPEN_REVIEW_DETAIL,
        leagueId: "l1",
        subject: { ...TRADE_SUBJECT, playersMovedAgain: true },
        decisions: ["no_action", "warned_user"],
      });
      await renderPage();

      expect(await screen.findByText(/One of these players has been traded again since/)).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "Reverse the trade" })).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "No action" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Warn the member" })).toBeInTheDocument();
    });

    it("says nothing about a moved-again player, or an already-reversed trade, on a normal reversible trade", async () => {
      vi.mocked(flagDetail).mockResolvedValue({
        ...OPEN_REVIEW_DETAIL,
        leagueId: "l1",
        subject: TRADE_SUBJECT,
        decisions: ["no_action", "warned_user", "trade_reversed"],
      });
      await renderPage();

      expect(await screen.findByRole("radio", { name: "Reverse the trade" })).toBeInTheDocument();
      expect(screen.queryByText(/traded again since/)).not.toBeInTheDocument();
      expect(screen.queryByText(/already reversed this trade/)).not.toBeInTheDocument();
    });

    /**
     * Fix round 2, F4. The raw Evidence panel drops `giving`/`receiving` for a trade subject —
     * the friendly `TradedPlayerList`s above already render that same data as names, positions
     * and points — but keeps every other evidence field (`verdict`, `gap`, `threshold`, ...),
     * since those have no friendly-card twin.
     */
    it("drops giving/receiving from the raw Evidence panel for a trade subject, keeping the non-duplicated fields", async () => {
      vi.mocked(flagDetail).mockResolvedValue({
        ...OPEN_REVIEW_DETAIL,
        leagueId: "l1",
        subject: TRADE_SUBJECT,
        decisions: ["no_action", "warned_user", "trade_reversed"],
        evidence: {
          verdict: "lopsided",
          flags: ["value_gap_over_threshold"],
          givingValue: 22.4,
          receivingValue: 3.1,
          gap: 19.3,
          threshold: 20,
          giving: [{ playerId: "p1", name: "Bijan Robinson", position: "RB", averagePoints: 22.4 }],
          receiving: [{ playerId: "p2", name: "Justin Jefferson", position: "WR", averagePoints: 18.1 }],
          basis: "accept_evaluation",
        },
      });
      await renderPage();

      expect(await screen.findByText("verdict")).toBeInTheDocument();
      expect(screen.getByText("gap")).toBeInTheDocument();
      expect(screen.getByText("threshold")).toBeInTheDocument();
      expect(screen.queryByText("giving")).not.toBeInTheDocument();
      expect(screen.queryByText("receiving")).not.toBeInTheDocument();
    });

    it("keeps giving/receiving in the raw Evidence panel for a non-trade subject (nothing to duplicate)", async () => {
      vi.mocked(flagDetail).mockResolvedValue({
        ...OPEN_REVIEW_DETAIL,
        evidence: { giving: ["irrelevant here"], receiving: ["also irrelevant"] },
      });
      await renderPage();

      expect(await screen.findByText("giving")).toBeInTheDocument();
      expect(screen.getByText("receiving")).toBeInTheDocument();
    });
  });

  it("renders the resolution — decision, note, who, and when — once a flag is already resolved, instead of a bare sentence, in both themes, axe-clean (fix round 1, FIX 5)", async () => {
    vi.mocked(flagDetail).mockResolvedValue({
      ...OPEN_REVIEW_DETAIL,
      resolution: {
        decision: "warned_user",
        note: "Please keep it civil in chat.",
        resolvedAt: "2026-08-02T00:00:00.000Z",
        resolvedByUserId: "u_op",
        resolvedByName: "Ada Operator",
      },
      decisions: [],
    });
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    const page = await callPage();
    await renderSurface(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <NoticesProvider>{page}</NoticesProvider>
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        expect(await screen.findByText("Ada Operator", { exact: false })).toBeInTheDocument();
        expect(screen.getByText(/sent the member a warning/)).toBeInTheDocument();
        expect(screen.getByText('"Please keep it civil in chat."')).toBeInTheDocument();
        expect(screen.queryByRole("radio")).not.toBeInTheDocument();
        expect(screen.queryByText("This flag is already resolved.")).not.toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("renders no blockquote for a resolution with an empty note", async () => {
    vi.mocked(flagDetail).mockResolvedValue({
      ...OPEN_REVIEW_DETAIL,
      resolution: { decision: "no_action", note: "", resolvedAt: "2026-08-02T00:00:00.000Z", resolvedByUserId: "u_op", resolvedByName: "Ada Operator" },
      decisions: [],
    });
    await renderPage();

    expect(await screen.findByText(/closed this flag with no action/)).toBeInTheDocument();
    expect(document.querySelector("blockquote")).toBeNull();
  });

  it("names the empty states honestly when there is nothing to show", async () => {
    vi.mocked(flagDetail).mockResolvedValue({ ...OPEN_REVIEW_DETAIL, reporters: [], trail: [] });
    await renderPage();

    expect(await screen.findByText("Nobody reported this. The platform raised it on its own.")).toBeInTheDocument();
    expect(screen.getByText("No recorded history for this flag yet.")).toBeInTheDocument();
    expect(screen.getByText("No evidence recorded for this flag.")).toBeInTheDocument();
  });
});

/**
 * Plan D, Task 5, fix round 1 (Finding 1) — the detail page's own rendered state, the exact
 * scenario the review's own bug trace names: an operator with this flag's URL open (a stale tab,
 * a bookmark, a browser-back after the world moved on) refreshes once the SYSTEM has already
 * closed it. Before this fix, `flagDetail` reported `resolution: null` for a system-closed flag
 * (`resolvedByUserId: null` collided with the "all four fields non-null" convention), so this
 * page rendered `HeldTradeDetail` — live Release/Block buttons — for a trade that had already
 * been decided. This asserts the honest render on both sides of that fix: OPEN still offers the
 * two buttons, CLOSED offers neither and says who (the platform), why, and when.
 */
describe("AdminFlagDetailPage — the held_trade subject arm (Plan D, Task 5, fix round 1)", () => {
  const HELD_TRADE_SUBJECT = {
    kind: "held_trade" as const,
    tradeId: "trade_1",
    proposerTeamName: "Team Alice",
    counterpartyTeamName: "Team Bob",
    gave: [{ playerId: "p1", name: "Star RB", position: "RB" as const, averagePoints: 22.4 }],
    got: [{ playerId: "p2", name: "Bench WR", position: "WR" as const, averagePoints: 3.1 }],
    valuationBasis: "The platform valued this trade the moment it was accepted.",
    fairnessGapSummary: "The two sides differ by 40 points per week, at or past the 35-point threshold that raised this flag.",
    proposerManager: { userId: "u_alice", name: "Alice", joinedAt: "2026-01-01T00:00:00.000Z", completedSeasons: 3 },
    counterpartyManager: { userId: "u_bob", name: "Bob", joinedAt: null, completedSeasons: 0 },
    noLongerHeldExplanation: null,
  };

  it("renders the two-button held-trade surface while the flag is still open", async () => {
    vi.mocked(flagDetail).mockResolvedValue({
      flagId: "flag_1",
      flagType: "trade_hold",
      raisedAt: "2026-08-20T00:00:00.000Z",
      leagueId: "l1",
      subject: HELD_TRADE_SUBJECT,
      evidence: {},
      reporters: [],
      trail: [{ eventId: "evt_1", occurredAt: "2026-08-20T00:00:00.000Z", icon: "alert-triangle", headline: "The platform held this trade for a fairness review.", detail: null }],
      resolution: null,
      decisions: ["trade_released", "trade_blocked"],
    });
    await renderPage();

    expect(await screen.findByRole("button", { name: "Release the trade" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Block the trade" })).toBeInTheDocument();
  });

  it("renders the honest closed state once the SYSTEM has resolved it — who, why, when, and NO decision buttons", async () => {
    vi.mocked(flagDetail).mockResolvedValue({
      flagId: "flag_1",
      flagType: "trade_hold",
      raisedAt: "2026-08-20T00:00:00.000Z",
      leagueId: "l1",
      subject: HELD_TRADE_SUBJECT,
      evidence: {},
      reporters: [],
      trail: [
        { eventId: "evt_1", occurredAt: "2026-08-20T00:00:00.000Z", icon: "alert-triangle", headline: "The platform held this trade for a fairness review.", detail: null },
        { eventId: "evt_2", occurredAt: "2026-08-21T00:00:00.000Z", icon: "check", headline: "The platform closed this flag once a different trade superseded it.", detail: null },
      ],
      // `resolvedByUserId: null`, exactly what `closeSupersededHoldFlag`
      // (`@/integrity-service/trade-fairness`) stamps — the SAME shape `flagDetail`'s own fix
      // now reports as resolved rather than open.
      resolution: {
        decision: "superseded_before_review",
        note: "A different trade moved one of these players before an operator could decide this one.",
        resolvedAt: "2026-08-21T00:00:00.000Z",
        resolvedByUserId: null,
        resolvedByName: "The platform",
      },
      decisions: [],
    });
    await renderPage();

    // "The platform" is its own `<span>` (`ResolutionSummary`'s actor-name styling), so it and the
    // phrase that follows it are separate text nodes — matched as two assertions, the same split
    // this file's own `"Ada Operator", { exact: false }` / `/sent the member a warning/` pair uses.
    expect(await screen.findByText("The platform", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/closed this flag once a different trade superseded it/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Release the trade" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Block the trade" })).not.toBeInTheDocument();
    // The note is still on the record, quoted — the same "keep the words on file" treatment
    // every other resolution summary already gives.
    expect(screen.getByText('"A different trade moved one of these players before an operator could decide this one."')).toBeInTheDocument();
  });
});
