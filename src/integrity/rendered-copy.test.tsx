import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { NoticeInbox } from "@/account-room/components/notice-inbox";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";
import type { NoticeView } from "@/account-room/contract";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { fixtureChatDeps } from "@/chat-room/test-fixtures";
import { ActivityFeed } from "@/league-room/components/activity-feed";
import type { ActivityRow } from "@/integrity/activity-view";
import type { TradeProposalView } from "@/trades/contract";
import type { ValuedPlayer } from "@/trades/fairness";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { DRAFT_SCHEDULE, HOME, LINEUP, PUBLIC_LEAGUES, TERMS, fixtureLeagueDeps } from "@/league-room/test-fixtures";
import { DraftSchedulePanel } from "@/league-room/components/draft-schedule-panel";
import { LeagueHome } from "@/league-room/components/league-home";
import { LeagueTermsPanel } from "@/league-room/components/league-terms-panel";
import { ModerationSummary } from "@/league-room/components/moderation-summary";
import { PublicLeagueList } from "@/league-room/components/public-league-list";
import { TradeCard } from "@/league-room/components/trade-card";
import { TradeComposer } from "@/league-room/components/trade-composer";
import type { ModerationSummaryView, TradeRoomContext } from "@/league-room/contract";
import { ReviewFeed } from "@/account-room/components/review-feed";
import type { ReviewsPage, ReviewView } from "@/reviews/contract";
import { copyViolations } from "./copy-rules";
import { renderNotice } from "./notices";

/**
 * THE HOUSE COPY RULES, APPLIED TO WHAT A PERSON ACTUALLY SEES.
 *
 * `notices.test.ts` sweeps the stored notice templates and `activity-view.test.ts` sweeps the
 * rendered activity sentences — both at the point the words are COMPOSED. Neither reaches the
 * words the components say in their own voice: the empty states, the pager label, the error copy,
 * the privacy statement, the aria-labels. Twelve such strings shipped swept by nothing at all, and
 * the mechanism was structural rather than careless: every sweep in this repo is per-module and
 * opt-in, so a new surface is covered only if its author remembers to write one.
 *
 * So this file is per-SURFACE rather than per-module, and it lives outside the four client-room
 * directories on purpose. Those directories may not value-import `@/integrity` (the client
 * boundary in `eslint.config.mjs`), and that ban is right — a room component has no business
 * reaching into the integrity module. A test that renders those components does. Adding a surface
 * here is one `describe` block, which is the point: one place to look, and one place to add.
 *
 * What is NOT swept here is content that arrives already composed (a notice's stored title and
 * body, a rendered activity headline). Those are swept where they are made, and re-sweeping them
 * against a fixture would prove only that the fixture is clean.
 */
const NOTICE: NoticeView = {
  id: "n1",
  noticeType: "draft_auto_picked",
  title: "We made your pick for you",
  body: "The clock ran out on pick 24 in Sunday Money, so we used your queue and drafted Bijan Robinson (RB).",
  quote: null,
  leagueId: "league_1",
  createdAt: "2026-08-18T20:00:00.000Z",
  readAt: null,
};

const ROW: ActivityRow = {
  eventId: "e1",
  occurredAt: "2026-08-18T20:00:00.000Z",
  icon: "check",
  headline: "Ada Lovelace drafted Bijan Robinson.",
  detail: "Round 1, pick 3.",
};

/** The component's OWN copy: everything on screen minus the content handed to it as props. */
function chromeOf(container: HTMLElement, ...content: readonly string[]): string {
  return content.reduce((text, piece) => text.replace(piece, ""), container.textContent ?? "");
}

function ariaLabelsOf(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll("[aria-label]")].map((node) => node.getAttribute("aria-label") ?? "");
}

function expectClean(container: HTMLElement, ...content: readonly string[]): void {
  expect(copyViolations(chromeOf(container, ...content))).toEqual([]);
  for (const label of ariaLabelsOf(container)) expect(copyViolations(label)).toEqual([]);
}

describe("ActivityFeed says nothing that breaks the house copy rules", () => {
  it("is clean empty, clean with a pager, and clean populated", () => {
    for (const element of [
      <ActivityFeed key="empty" rows={[]} leagueId="league_1" nextBefore={null} />,
      <ActivityFeed key="empty-paged" rows={[]} leagueId="league_1" nextBefore={7} />,
      <ActivityFeed key="populated" rows={[ROW]} leagueId="league_1" nextBefore={41} />,
    ]) {
      const { container, unmount } = render(element);
      expectClean(container, ROW.headline, ROW.detail ?? "");
      unmount();
    }
  });
});

describe("NoticeInbox says nothing that breaks the house copy rules", () => {
  it("is clean closed, open, empty and failed", async () => {
    for (const page of [
      { ok: true as const, data: { notices: [], unreadCount: 0 } },
      { ok: true as const, data: { notices: [NOTICE], unreadCount: 1 } },
      { ok: false as const, error: "unreachable" },
    ]) {
      const fixture = fixtureAccountDeps(page);
      const { container, unmount } = render(
        <AccountRoomDepsProvider deps={fixture.deps}>
          <NoticeInbox />
        </AccountRoomDepsProvider>,
      );
      const trigger = await within(container).findByRole("button", { name: /^Notices/ });
      expectClean(container, NOTICE.title, NOTICE.body);

      fireEvent.click(trigger);
      await waitFor(() => expectClean(container, NOTICE.title, NOTICE.body));
      unmount();
    }
  });
});

/**
 * The page is a Server Component, so it is called rather than rendered, with its data seams
 * mocked exactly the way its own route test does it. Worth the setup: its three sentences include
 * the persona panel's FIX-5 privacy statement, which is the single most carefully worded string on
 * the surface and was covered by no sweep at all.
 */
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("@/lib/leagues/membership", () => ({ resolveLeagueMembership: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/draft-service/teams", () => ({ leagueNameFor: vi.fn() }));
vi.mock("@/integrity-service/activity", () => ({ listLeagueActivity: vi.fn() }));
vi.mock("@/integrity-service/notify", () => ({ listNotices: vi.fn(), quoteFor: vi.fn(() => null) }));
vi.mock("@/integrity-service/flags", () => ({ listPendingFlags: vi.fn(), flagDetail: vi.fn() }));
// `ResolutionForm` (Task 5, `src/admin-room/components/resolution-form.tsx`) calls `useRouter()`
// for its post-submit `router.refresh()` — `notFound()` needs no request context (a plain
// synchronous throw), so it stays real; `useRouter()` is the one export this file mocks.
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) };
});

describe("the league activity page says nothing that breaks the house copy rules", () => {
  it("is clean with and without a platform-action band", async () => {
    const { requireCurrentUser } = await import("@/lib/auth/current-user");
    const { resolveLeagueMembership } = await import("@/lib/leagues/membership");
    const { leagueNameFor } = await import("@/draft-service/teams");
    const { listLeagueActivity } = await import("@/integrity-service/activity");
    const { listNotices } = await import("@/integrity-service/notify");
    const { default: LeagueActivityPage } = await import("@/app/app/leagues/[leagueId]/activity/page");

    vi.mocked(requireCurrentUser).mockResolvedValue({
      id: "u1", email: "u1@test.local", displayName: "Ada Lovelace", experienceTier: "beginner", avatarUrl: null,
      createdAt: "2026-08-01T00:00:00.000Z", isAdmin: false,
    });
    vi.mocked(resolveLeagueMembership).mockResolvedValue({
      ok: true,
      membership: { leagueId: "league_1", teamId: "team_1", isCommissioner: false },
    });
    vi.mocked(leagueNameFor).mockResolvedValue("Sunday Money");
    vi.mocked(listLeagueActivity).mockResolvedValue({ rows: [ROW], nextBefore: null });

    for (const notices of [
      [],
      [{
        id: "n1", userId: "u1", leagueId: "league_1", noticeType: "draft_auto_picked" as const,
        title: NOTICE.title, body: NOTICE.body, context: {}, auditEventId: "evt_1",
        createdAt: NOTICE.createdAt, readAt: null,
      }],
    ]) {
      vi.mocked(listNotices).mockResolvedValue({ notices, unreadCount: notices.length });
      const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
      const page = await LeagueActivityPage({ params: Promise.resolve({ leagueId: "league_1" }), searchParams: Promise.resolve({}) });
      const { container, unmount } = render(<AccountRoomDepsProvider deps={fixture.deps}>{page}</AccountRoomDepsProvider>);
      await screen.findByText("League activity");
      expectClean(container, NOTICE.title, NOTICE.body, ROW.headline, ROW.detail ?? "");
      unmount();
    }
  });
});

const QUEUE_ROW = { flagId: "flag_1", icon: "alert-triangle" as const, question: "A member reported a review", about: "A review by Ada Lovelace", raisedAt: "2026-08-01T00:00:00.000Z" };

const FLAG_DETAIL = {
  flagId: "flag_1",
  flagType: "review_report" as const,
  raisedAt: "2026-08-01T00:00:00.000Z",
  leagueId: null,
  subject: { kind: "review" as const, reviewId: "r1", body: "Great season overall.", authorName: "Ada Lovelace", removedAt: null },
  evidence: {},
  reporters: [{ userId: "u_reporter", name: "Reporter Rita", reason: "spam", reportedAt: "2026-08-01T00:00:01.000Z" }],
  trail: [ROW],
  resolution: null,
  decisions: ["no_action", "warned_user", "content_removed"] as const,
};

const OPERATOR = { id: "u_op", email: "u_op@test.local", displayName: "Op Erator", experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-01T00:00:00.000Z", isAdmin: true };

/**
 * Task 5's operator surface — added as its own `describe` block, per this file's own point.
 * `withAdmin`'s Server Component overload is exercised for real (only `requireAdmin` is mocked),
 * so this also proves the gate itself renders clean copy, not just the read below it.
 */
describe("the admin queue page says nothing that breaks the house copy rules", () => {
  it("is clean empty and clean populated", async () => {
    const { requireAdmin } = await import("@/lib/auth/current-user");
    const { listPendingFlags } = await import("@/integrity-service/flags");
    const { default: AdminQueuePage } = await import("@/app/app/admin/queue/page");

    vi.mocked(requireAdmin).mockResolvedValue(OPERATOR);

    for (const rows of [[], [QUEUE_ROW]]) {
      vi.mocked(listPendingFlags).mockResolvedValue({ rows, nextBefore: null });
      const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
      const page = await AdminQueuePage({ searchParams: Promise.resolve({}) });
      const { container, unmount } = render(<AccountRoomDepsProvider deps={fixture.deps}>{page}</AccountRoomDepsProvider>);
      await screen.findByText("Dispute queue");
      expectClean(container, QUEUE_ROW.question, QUEUE_ROW.about);
      unmount();
    }
  });
});

describe("the admin flag detail page says nothing that breaks the house copy rules", () => {
  it("is clean open, resolved, and with every panel empty", async () => {
    const { requireAdmin } = await import("@/lib/auth/current-user");
    const { flagDetail } = await import("@/integrity-service/flags");
    const { leagueNameFor } = await import("@/draft-service/teams");
    const { default: AdminFlagDetailPage } = await import("@/app/app/admin/queue/[flagId]/page");

    vi.mocked(requireAdmin).mockResolvedValue(OPERATOR);
    vi.mocked(leagueNameFor).mockResolvedValue("Sunday Money");

    const TRADE_SUBJECT = {
      kind: "trade" as const,
      tradeId: "trade_1",
      proposerTeamName: "Bay Bandits",
      counterpartyTeamName: "Iron Owls",
      gave: [{ playerId: "p1", name: "Bijan Robinson", position: "RB" as const, averagePoints: 22.4 }],
      got: [{ playerId: "p2", name: "Justin Jefferson", position: "WR" as const, averagePoints: 18.1 }],
      acceptedAt: "2026-08-10T00:00:00.000Z",
      reversedAt: null,
      valuationBasis: "The platform valued this trade the moment it was accepted.",
      fairnessGapSummary: "The two sides differ by 4.3 points per week, at or past the 20-point threshold that raised this flag.",
      playersMovedAgain: false,
    };

    for (const detail of [
      FLAG_DETAIL,
      { ...FLAG_DETAIL, resolution: { decision: "no_action" as const, note: "n", resolvedAt: "2026-08-02T00:00:00.000Z", resolvedByUserId: "u_op", resolvedByName: "Op Erator" }, decisions: [] },
      { ...FLAG_DETAIL, reporters: [], trail: [] },
      { ...FLAG_DETAIL, leagueId: "l1", flagType: "trade_fairness" as const, subject: TRADE_SUBJECT, decisions: ["no_action", "warned_user", "trade_reversed"] as const },
      { ...FLAG_DETAIL, leagueId: "l1", flagType: "trade_fairness" as const, subject: { ...TRADE_SUBJECT, reversedAt: "2026-08-15T00:00:00.000Z" }, decisions: ["no_action", "warned_user"] as const },
      { ...FLAG_DETAIL, leagueId: "l1", flagType: "trade_fairness" as const, subject: { ...TRADE_SUBJECT, playersMovedAgain: true }, decisions: ["no_action", "warned_user"] as const },
    ]) {
      vi.mocked(flagDetail).mockResolvedValue(detail);
      const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
      const page = await AdminFlagDetailPage({ params: Promise.resolve({ flagId: "flag_1" }) });
      const { container, unmount } = render(<AccountRoomDepsProvider deps={fixture.deps}>{page}</AccountRoomDepsProvider>);
      await screen.findByText("Flag detail");
      expectClean(container, detail.subject.kind === "review" ? detail.subject.body : "", ROW.headline, ROW.detail ?? "");
      unmount();
    }
  });
});

describe("the admin flag detail page's held-trade surface says nothing that breaks the house copy rules (Plan D, Task 5)", () => {
  it("is clean open (with the two decisions offered) and resolved", async () => {
    const { requireAdmin } = await import("@/lib/auth/current-user");
    const { flagDetail } = await import("@/integrity-service/flags");
    const { leagueNameFor } = await import("@/draft-service/teams");
    const { default: AdminFlagDetailPage } = await import("@/app/app/admin/queue/[flagId]/page");

    vi.mocked(requireAdmin).mockResolvedValue(OPERATOR);
    vi.mocked(leagueNameFor).mockResolvedValue("Sunday Money");

    const HELD_TRADE_SUBJECT = {
      kind: "held_trade" as const,
      tradeId: "trade_1",
      proposerTeamName: "Bay Bandits",
      counterpartyTeamName: "Iron Owls",
      gave: [{ playerId: "p1", name: "Bijan Robinson", position: "RB" as const, averagePoints: 22.4 }],
      got: [{ playerId: "p2", name: "Justin Jefferson", position: "WR" as const, averagePoints: 18.1 }],
      valuationBasis: "The platform valued this trade the moment it was accepted.",
      fairnessGapSummary: "The two sides differ by 40 points per week, at or past the 35-point threshold that raised this flag.",
      proposerManager: { userId: "u_bb", name: "Bay Bandits Owner", joinedAt: "2026-01-01T00:00:00.000Z", completedSeasons: 3 },
      counterpartyManager: { userId: "u_io", name: "Iron Owls Owner", joinedAt: null, completedSeasons: 0 },
    };
    const HELD_DETAIL = {
      ...FLAG_DETAIL,
      leagueId: "l1",
      flagType: "trade_hold" as const,
      subject: HELD_TRADE_SUBJECT,
      reporters: [],
      trail: [{ eventId: "e2", occurredAt: "2026-08-18T20:00:00.000Z", icon: "alert-triangle" as const, headline: "The platform held this trade for a fairness review.", detail: null }],
      decisions: ["trade_released", "trade_blocked"] as const,
    };

    for (const detail of [
      HELD_DETAIL,
      { ...HELD_DETAIL, trail: [] },
      {
        ...HELD_DETAIL,
        resolution: { decision: "trade_blocked" as const, note: "Both teams belong to one person.", resolvedAt: "2026-08-02T00:00:00.000Z", resolvedByUserId: "u_op", resolvedByName: "Op Erator" },
        decisions: [],
      },
    ]) {
      vi.mocked(flagDetail).mockResolvedValue(detail);
      const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
      const page = await AdminFlagDetailPage({ params: Promise.resolve({ flagId: "flag_1" }) });
      const { container, unmount } = render(<AccountRoomDepsProvider deps={fixture.deps}>{page}</AccountRoomDepsProvider>);
      await screen.findByText("Held trade");
      expectClean(container, "Bijan Robinson", "Justin Jefferson", "Bay Bandits Owner", "Iron Owls Owner", "Both teams belong to one person.");
      unmount();
    }
  });

  it("is clean with a note typed and on both confirmation dialogs", async () => {
    const { requireAdmin } = await import("@/lib/auth/current-user");
    const { flagDetail } = await import("@/integrity-service/flags");
    const { leagueNameFor } = await import("@/draft-service/teams");
    const { default: AdminFlagDetailPage } = await import("@/app/app/admin/queue/[flagId]/page");

    vi.mocked(requireAdmin).mockResolvedValue(OPERATOR);
    vi.mocked(leagueNameFor).mockResolvedValue("Sunday Money");

    const detail = {
      ...FLAG_DETAIL,
      leagueId: "l1",
      flagType: "trade_hold" as const,
      subject: {
        kind: "held_trade" as const,
        tradeId: "trade_1",
        proposerTeamName: "Bay Bandits",
        counterpartyTeamName: "Iron Owls",
        gave: [{ playerId: "p1", name: "Bijan Robinson", position: "RB" as const, averagePoints: 22.4 }],
        got: [{ playerId: "p2", name: "Justin Jefferson", position: "WR" as const, averagePoints: 18.1 }],
        valuationBasis: "The platform valued this trade the moment it was accepted.",
        fairnessGapSummary: "The two sides differ by 40 points per week, at or past the 35-point threshold that raised this flag.",
        proposerManager: { userId: "u_bb", name: "Bay Bandits Owner", joinedAt: "2026-01-01T00:00:00.000Z", completedSeasons: 3 },
        counterpartyManager: { userId: "u_io", name: "Iron Owls Owner", joinedAt: null, completedSeasons: 0 },
      },
      reporters: [],
      trail: [],
      decisions: ["trade_released", "trade_blocked"] as const,
    };
    vi.mocked(flagDetail).mockResolvedValue(detail);
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    const page = await AdminFlagDetailPage({ params: Promise.resolve({ flagId: "flag_1" }) });
    const { container } = render(<AccountRoomDepsProvider deps={fixture.deps}>{page}</AccountRoomDepsProvider>);
    await screen.findByText("Held trade");

    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "Looks like the same person on both sides." } });
    expectClean(container, "Bijan Robinson", "Justin Jefferson", "Bay Bandits Owner", "Iron Owls Owner", "Looks like the same person on both sides.");

    fireEvent.click(screen.getByRole("button", { name: "Release the trade" }));
    expectClean(container, "Bijan Robinson", "Justin Jefferson", "Bay Bandits Owner", "Iron Owls Owner", "Looks like the same person on both sides.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Block the trade" }));
    expectClean(container, "Bijan Robinson", "Justin Jefferson", "Bay Bandits Owner", "Iron Owls Owner", "Looks like the same person on both sides.");
  });

  /**
   * THE SWEEP GAP THIS FIX ROUND CLOSED (F4): every test above stops at the confirmation DIALOG —
   * none of them ever clicked "Confirm", so `HeldTradeDetail`'s own DONE state (the sentence
   * rendered once a decision actually lands) never mounted here, which is exactly how the em dash
   * in that sentence (`held-trade-detail.tsx`, "This cannot be changed here — a different
   * decision is a new flag.") escaped this file's own reason for existing (this describe block's
   * own docblock, restated: "it renders FIRST PAINT ... copy behind an interaction never
   * mounts"). Driven through `HeldTradeDetail` directly, mirroring `ResolutionForm`'s own "is
   * clean once a decision is recorded" test just above, rather than through the full page — the
   * done state needs a REAL `AdminRoomDepsProvider` fetch to succeed, and the full-page tests
   * above only ever wrap `AccountRoomDepsProvider` (for `AppHeader`'s own notice inbox), never
   * `AdminRoomDepsProvider` — so a click-to-Confirm through the full page would have hit a REAL
   * network call and landed on the ERROR state, not the done one, proving nothing about this
   * sentence either way.
   */
  it.each(["Release the trade", "Block the trade"] as const)("is clean once %s is confirmed and the decision is recorded", async (buttonLabel) => {
    const { AdminRoomDepsProvider } = await import("@/admin-room/hooks/deps");
    const { fixtureAdminDeps } = await import("@/admin-room/test-fixtures");
    const { HeldTradeDetail } = await import("@/admin-room/components/held-trade-detail");

    const fixture = fixtureAdminDeps({ ok: true, data: { flagId: "flag_1", decision: "trade_released" } });
    const { container } = render(
      <AdminRoomDepsProvider deps={fixture.deps}>
        <HeldTradeDetail
          flagId="flag_1"
          subject={{
            kind: "held_trade",
            tradeId: "trade_1",
            proposerTeamName: "Bay Bandits",
            counterpartyTeamName: "Iron Owls",
            gave: [{ playerId: "p1", name: "Bijan Robinson", position: "RB", averagePoints: 22.4 }],
            got: [{ playerId: "p2", name: "Justin Jefferson", position: "WR", averagePoints: 18.1 }],
            valuationBasis: "The platform valued this trade the moment it was accepted.",
            fairnessGapSummary: "The two sides differ by 40 points per week, at or past the 35-point threshold that raised this flag.",
            proposerManager: { userId: "u_bb", name: "Bay Bandits Owner", joinedAt: "2026-01-01T00:00:00.000Z", completedSeasons: 3 },
            counterpartyManager: { userId: "u_io", name: "Iron Owls Owner", joinedAt: null, completedSeasons: 0 },
          }}
          trail={[]}
          noteMaxLength={500}
        />
      </AdminRoomDepsProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: buttonLabel }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expectClean(container, "Bijan Robinson", "Justin Jefferson", "Bay Bandits Owner", "Iron Owls Owner");
  });
});

/**
 * THE INTERACTION-STATE GAP, closed (final review, MEDIUM 7(b)). Everything above renders a FIRST
 * PAINT, and `ResolutionForm` initializes `decision` to `decisions[0]` — the fixture's
 * `no_action` — so two of the three decision branches, and every state that follows typing a
 * note, were swept by nothing. That is exactly where MEDIUM 6's em dash lived: on the
 * `content_removed` hint, in a component the sweep above mounts on every run.
 *
 * So: every decision, with and without a note, and the submitted state too. Driven through the
 * real radios rather than by re-rendering with a different prop, because the branch that ships is
 * the one an operator clicks into.
 */
describe("the resolution form says nothing that breaks the house copy rules, in every state", () => {
  const PREVIEWS = {
    warned_user: { title: "An operator reviewed a report about you", body: "We looked at a report about something you posted in Sunday Money." },
    content_removed: { title: "We removed your review", body: "An operator removed your review. We keep your review on file exactly as you wrote it. There is no reply to this message." },
    trade_reversed: {
      title: "An operator reversed your trade",
      body: "An operator reversed the trade you and Iron Owls completed in Sunday Money. You have Bijan Robinson again, and Iron Owls has Justin Jefferson. Scores from weeks you have already played stay as they were. There is no reply to this message.",
    },
  } as const;
  const DECISION_RADIOS = ["No action", "Warn the member", "Remove the content", "Reverse the trade"] as const;

  it.each(DECISION_RADIOS)("is clean on the %s branch, empty and with a note", async (radioLabel) => {
    const { AdminRoomDepsProvider } = await import("@/admin-room/hooks/deps");
    const { fixtureAdminDeps } = await import("@/admin-room/test-fixtures");
    const { ResolutionForm } = await import("@/admin-room/components/resolution-form");

    const fixture = fixtureAdminDeps();
    const { container } = render(
      <AdminRoomDepsProvider deps={fixture.deps}>
        <ResolutionForm
          flagId="flag_1"
          decisions={["no_action", "warned_user", "content_removed", "trade_reversed"]}
          noteMaxLength={500}
          previews={PREVIEWS}
          isChatSubject={false}
        />
      </AdminRoomDepsProvider>,
    );

    const allPreviewCopy = [
      PREVIEWS.warned_user.title,
      PREVIEWS.warned_user.body,
      PREVIEWS.content_removed.title,
      PREVIEWS.content_removed.body,
      PREVIEWS.trade_reversed.title,
      PREVIEWS.trade_reversed.body,
    ];

    fireEvent.click(screen.getByRole("radio", { name: radioLabel }));
    expectClean(container, ...allPreviewCopy);

    // And again once the operator has typed, since the previews swap their placeholder for the
    // note the moment there is one.
    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "Keep it civil." } });
    expectClean(container, ...allPreviewCopy, '"Keep it civil."');
  });

  it("is clean once a decision is recorded", async () => {
    const { AdminRoomDepsProvider } = await import("@/admin-room/hooks/deps");
    const { fixtureAdminDeps } = await import("@/admin-room/test-fixtures");
    const { ResolutionForm } = await import("@/admin-room/components/resolution-form");

    const fixture = fixtureAdminDeps();
    const { container } = render(
      <AdminRoomDepsProvider deps={fixture.deps}>
        <ResolutionForm flagId="flag_1" decisions={["no_action"]} noteMaxLength={500} previews={PREVIEWS} isChatSubject={false} />
      </AdminRoomDepsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit decision" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expectClean(container);
  });
});

/**
 * Task 8. `TRADE_TEAM_COPY` below is the content this sweep subtracts before checking the rest —
 * team names, player names, and the note a proposer typed — the same "everything else is house
 * copy" discipline `expectClean`'s own callers use throughout this file. Every `TradeCard` status
 * branch gets its own render (open/inbound, open/outbound, accepted, accepted+reversed, rejected,
 * withdrawn, expired, superseded), plus the confirm dialog opened on the one status that has an
 * Accept control — Plan B's final review found an em dash on a branch that never mounted, and a
 * `Modal` opened only by a click is exactly that shape of gap.
 */
const TRADE_PLAYERS: Readonly<Record<string, ValuedPlayer>> = {
  p1: { playerId: "p1", name: "Bijan Robinson", position: "RB", averagePoints: 18.2 },
  p2: { playerId: "p2", name: "Puka Nacua", position: "WR", averagePoints: 15.4 },
};

/** Three days out from whenever this suite runs — see `trade-inbox.test.tsx`'s own note. An open
 *  offer's controls and copy now depend on whether its expiry has passed (final review, HIGH 3),
 *  so a fixed past date would silently turn every "open" state below into the expired one. The
 *  expired states this sweep DOES need are written explicitly, with a past `expiresAt`. */
const LIVE_EXPIRY = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const PAST_EXPIRY = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

const TRADE_BASE: TradeProposalView = {
  id: "trade_1",
  leagueId: "league_1",
  weekNumber: 5,
  status: "open",
  proposedAt: "2026-08-18T00:00:00.000Z",
  expiresAt: LIVE_EXPIRY,
  settledAt: null,
  reversedAt: null,
  note: null,
  from: { teamId: "them", teamName: "Iron Owls", assets: [{ kind: "player", playerId: "p1" }] },
  to: { teamId: "me", teamName: "Bay Bandits", assets: [{ kind: "player", playerId: "p2" }] },
};

const TRADE_CONTENT = ["Iron Owls", "Bay Bandits", "Bijan Robinson", "Puka Nacua"];

describe("TradeCard says nothing that breaks the house copy rules, in every status", () => {
  it("is clean across every status a stored proposal can hold", () => {
    const states: readonly { readonly label: string; readonly trade: TradeProposalView; readonly meTeamId: string }[] = [
      { label: "open, answerable", trade: TRADE_BASE, meTeamId: "me" },
      { label: "open, waiting on a reply", trade: TRADE_BASE, meTeamId: "them" },
      { label: "accepted", trade: { ...TRADE_BASE, status: "accepted", settledAt: "2026-08-19T00:00:00.000Z" }, meTeamId: "me" },
      { label: "accepted, then reversed", trade: { ...TRADE_BASE, status: "accepted", settledAt: "2026-08-19T00:00:00.000Z", reversedAt: "2026-08-20T00:00:00.000Z" }, meTeamId: "me" },
      { label: "rejected", trade: { ...TRADE_BASE, status: "rejected", settledAt: "2026-08-19T00:00:00.000Z" }, meTeamId: "me" },
      { label: "withdrawn, by me", trade: { ...TRADE_BASE, status: "withdrawn", settledAt: "2026-08-19T00:00:00.000Z" }, meTeamId: "them" },
      { label: "withdrawn, by them", trade: { ...TRADE_BASE, status: "withdrawn", settledAt: "2026-08-19T00:00:00.000Z" }, meTeamId: "me" },
      { label: "expired", trade: { ...TRADE_BASE, status: "expired" }, meTeamId: "me" },
      // Final review, HIGH 3: the two states a DERIVED expiry actually produces. Nothing writes
      // `status = 'expired'`, so a dead offer reaches the card still `open` — and both parties'
      // copy for that state is new, which makes it exactly the copy this sweep exists to check.
      { label: "open, past its expiry, seen by the counterparty", trade: { ...TRADE_BASE, expiresAt: PAST_EXPIRY }, meTeamId: "me" },
      { label: "open, past its expiry, seen by the proposer", trade: { ...TRADE_BASE, expiresAt: PAST_EXPIRY }, meTeamId: "them" },
      { label: "superseded", trade: { ...TRADE_BASE, status: "superseded", settledAt: "2026-08-19T00:00:00.000Z" }, meTeamId: "me" },
      { label: "with a note", trade: { ...TRADE_BASE, note: "Rebuilding my TE spot" }, meTeamId: "me" },
      // Plan D, Task 5: the auto-hold's own two new statuses.
      { label: "held", trade: { ...TRADE_BASE, status: "held" }, meTeamId: "me" },
      { label: "held, seen by the other side", trade: { ...TRADE_BASE, status: "held" }, meTeamId: "them" },
      { label: "blocked", trade: { ...TRADE_BASE, status: "blocked", settledAt: "2026-08-19T00:00:00.000Z" }, meTeamId: "me" },
    ];

    for (const { trade, meTeamId } of states) {
      const { container, unmount } = render(
        <TradeCard
          trade={trade}
          meTeamId={meTeamId}
          playersById={TRADE_PLAYERS}
          leagueName="Sunday Money"
          assessmentStatus="ready"
          assessment={{ verdict: "lopsided", givingValue: 5, receivingValue: 40 }}
        />,
      );
      expectClean(container, ...TRADE_CONTENT, '"Rebuilding my TE spot"');
      unmount();
    }
  });

  it("is clean on the accept confirm dialog", () => {
    const { container } = render(<TradeCard trade={TRADE_BASE} meTeamId="me" playersById={TRADE_PLAYERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expectClean(container, ...TRADE_CONTENT);
  });

  /**
   * Plan D, Task 5's own binding requirement: a member reading two different sentences about one
   * fact reads one of them as a euphemism, so `held-trade-banner.tsx` says the SAME sentence
   * `trade_held_for_review`'s own notice says — copied by necessity (`@/integrity` is blocked as
   * a value import from room code), kept honest here by rendering both and comparing the text
   * directly rather than trusting the two authors to never drift.
   */
  it("says the identical sentence a held trade's own notice says — the banner and the notice must never drift", () => {
    render(<TradeCard trade={{ ...TRADE_BASE, status: "held" }} meTeamId="me" playersById={TRADE_PLAYERS} leagueName="Sunday Money" />);
    const notice = renderNotice("trade_held_for_review", { leagueName: "Sunday Money", counterpartyTeamName: "Iron Owls" });
    expect(screen.getByText(notice.body)).toBeInTheDocument();
  });

  // Fix round 1, F4: three more interaction states this card can be in — idle (nobody has asked
  // for a verdict yet), loading, and a failed fetch's own retry offer — none of them swept before
  // the lazy-verdict fix existed.
  it("is clean idle, loading, and on a failed verdict fetch", () => {
    for (const status of ["idle", "loading", "error"] as const) {
      const { container, unmount } = render(<TradeCard trade={TRADE_BASE} meTeamId="me" playersById={TRADE_PLAYERS} assessmentStatus={status} />);
      expectClean(container, ...TRADE_CONTENT);
      unmount();
    }
  });
});

const TRADE_CONTEXT: TradeRoomContext = {
  weekNumber: 5,
  myTeamId: "me",
  counterparties: [{ teamId: "them", teamName: "Iron Owls" }],
  rostersByTeamId: {
    me: [{ playerId: "p1", name: "Bijan Robinson", position: "RB" }],
    them: [{ playerId: "p2", name: "Puka Nacua", position: "WR" }],
  },
  leagueName: "Sunday Money",
};

describe("TradeComposer says nothing that breaks the house copy rules, with and without a note", () => {
  it("is clean before a team is chosen, after players are picked, and with a note typed", async () => {
    const onAssess = vi.fn().mockResolvedValue({
      ok: true,
      data: { headline: "Close call.", reasoning: "Both sides give up similar weekly production.", degraded: false, verdict: "even", flags: [], givingValue: 18, receivingValue: 17.5 },
    });
    const { container } = render(
      <LeagueRoomDepsProvider deps={fixtureLeagueDeps().deps}>
        <TradeComposer context={TRADE_CONTEXT} onAssess={onAssess} onPropose={vi.fn()} onDone={vi.fn()} onCancel={vi.fn()} />
      </LeagueRoomDepsProvider>,
    );
    expectClean(container, ...TRADE_CONTENT);

    fireEvent.change(screen.getByLabelText("Trade with"), { target: { value: "them" } });
    fireEvent.click(screen.getByLabelText(/Bijan Robinson/));
    fireEvent.click(screen.getByLabelText(/Puka Nacua/));
    await waitFor(() => expect(onAssess).toHaveBeenCalled());
    await screen.findByText(/close to even/i);
    expectClean(container, ...TRADE_CONTENT, "Close call.", "Both sides give up similar weekly production.");

    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "Rebuilding my TE spot" } });
    expectClean(container, ...TRADE_CONTENT, "Close call.", "Both sides give up similar weekly production.");
  });
});

/**
 * Task 6, fix round 1 (review LOW). `LeagueTermsPanel`, `PublicLeagueList`, `DraftSchedulePanel`
 * and `LeagueHome` all render `formatDraftTime`'s (`@/league/terms`) COMPOSED output — a string
 * assembled at runtime from a weekday, a day, a month, a time and a relative clause, never a
 * literal in the source. `room-copy.source.test.ts`'s own docblock states its blind spot exactly:
 * it is BLIND TO COMPOSITION, so `{terms.draftAt}` (a JSX expression, not text between `>` and
 * `<`) was invisible to it, whole. This file is the one sweep that reads what a person actually
 * SEES, so it is the one that can check the composed string for real — and, deliberately, every
 * `expectClean` call below leaves that string IN rather than subtracting it, unlike the user
 * names subtracted alongside it: subtracting `draftAt` would exempt the exact content this block
 * exists to add coverage for.
 */
describe("LeagueTermsPanel says nothing that breaks the house copy rules, including the composed draft time", () => {
  it("is clean with a real composed draft time rendered", () => {
    const { container } = render(<LeagueTermsPanel terms={TERMS} />);
    expectClean(container, TERMS.name, TERMS.commissionerName);
  });
});

describe("PublicLeagueList says nothing that breaks the house copy rules, including each card's composed draft time", () => {
  it("is clean signed in, signed out, and empty", () => {
    for (const element of [
      <PublicLeagueList key="signed-in" leagues={PUBLIC_LEAGUES} signedIn={true} />,
      <PublicLeagueList key="signed-out" leagues={PUBLIC_LEAGUES} signedIn={false} />,
      <PublicLeagueList key="empty" leagues={[]} signedIn={true} />,
    ]) {
      const { container, unmount } = render(element);
      expectClean(container, ...PUBLIC_LEAGUES.map((league) => league.name));
      unmount();
    }
  });
});

describe("DraftSchedulePanel says nothing that breaks the house copy rules, including its own composed countdown", () => {
  it("is clean scheduled, starting soon, in progress, complete, and with the edit form open", () => {
    const fixture = fixtureLeagueDeps();
    const scheduledSoon = { ...DRAFT_SCHEDULE, status: "scheduled" as const, kickoffAt: new Date(Date.now() + 20 * 60 * 1000).toISOString() };
    const scheduledLater = {
      ...DRAFT_SCHEDULE,
      status: "scheduled" as const,
      kickoffAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      isPublicMatchmade: true,
    };
    for (const schedule of [scheduledLater, scheduledSoon, { ...DRAFT_SCHEDULE, status: "in_progress" as const }, { ...DRAFT_SCHEDULE, status: "complete" as const }]) {
      const { container, unmount } = render(
        <LeagueRoomDepsProvider deps={fixture.deps}>
          <DraftSchedulePanel leagueId="l1" isCommissioner={true} initialSchedule={schedule} />
        </LeagueRoomDepsProvider>,
      );
      expectClean(container);
      unmount();
    }

    const { container } = render(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <DraftSchedulePanel leagueId="l1" isCommissioner={true} initialSchedule={scheduledLater} />
      </LeagueRoomDepsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit time" }));
    expectClean(container);
  });
});

describe("LeagueHome says nothing that breaks the house copy rules, including every composed date it renders", () => {
  it("is clean for the commissioner and for an ordinary member", async () => {
    for (const home of [HOME, { ...HOME, isCommissioner: false }]) {
      const { container, unmount } = render(
        <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
          <LeagueRoomDepsProvider deps={fixtureLeagueDeps().deps}>
            <LeagueHome home={home} lineup={LINEUP} />
          </LeagueRoomDepsProvider>
        </ChatRoomDepsProvider>,
      );
      await waitFor(() => expect(screen.getByRole("region", { name: "League chat" })).toBeInTheDocument());
      expectClean(
        container,
        home.name,
        home.terms.commissionerName,
        ...home.teams.map((team) => team.name),
        ...home.teams.map((team) => team.ownerDisplayName),
      );
      unmount();
    }
  });
});

/**
 * Task 8. `ModerationSummary` composes its own sentence and (on the populated branch) a
 * formatted date from `mostRecentAt` — the exact kind of runtime composition
 * `room-copy.source.test.ts` cannot see, so this is the sweep that actually checks it.
 */
describe("ModerationSummary says nothing that breaks the house copy rules", () => {
  const POPULATED: ModerationSummaryView = { removedMessages: 2, removedReviews: 1, mostRecentAt: "2026-08-19T14:02:00.000Z", openQuestions: 1 };
  const HEALTHY: ModerationSummaryView = { removedMessages: 0, removedReviews: 0, mostRecentAt: null, openQuestions: 0 };

  it("is clean loading, healthy, populated with a composed date, and on a failed fetch", async () => {
    for (const response of [{ ok: true as const, data: POPULATED }, { ok: true as const, data: HEALTHY }, { ok: false as const, error: "unreachable" }]) {
      const fixture = fixtureLeagueDeps(response);
      const { container, unmount } = render(
        <LeagueRoomDepsProvider deps={fixture.deps}>
          <ModerationSummary leagueId="league_1" />
        </LeagueRoomDepsProvider>,
      );
      await waitFor(() => expect(screen.getByRole("region", { name: "Platform moderation in this league" })).toBeInTheDocument());
      expectClean(container);
      unmount();
    }
  });
});

/**
 * Task 8's other half. `account-room` carries no directory-derived source sweep at all
 * (`room-copy.source.test.ts`'s own `ROOM_DIRS` names only the four client-room directories that
 * predate it), so `ReviewFeed` — the one component in this task that gained new rendered text,
 * the verified badge — gets its coverage here instead, the same "one place to add" shape this
 * file's own docblock describes.
 */
const VERIFIED_REVIEW: ReviewView = {
  id: "r_sweep",
  rating: 5,
  body: "This league runs itself.",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  authorName: "Ada Lovelace",
  authorAvatar: null,
  verified: true,
};

describe("ReviewFeed says nothing that breaks the house copy rules, verified badge included", () => {
  it("is clean with an unverified review, a verified one, and the badge's own InfoTip opened", () => {
    const unverifiedPage: ReviewsPage = { reviews: [{ ...VERIFIED_REVIEW, id: "r_unverified", verified: false }], hasMore: false, nextBefore: null };
    const verifiedPage: ReviewsPage = { reviews: [VERIFIED_REVIEW], hasMore: false, nextBefore: null };

    for (const page of [unverifiedPage, verifiedPage]) {
      const fixture = fixtureAccountDeps();
      const { container, unmount } = render(
        <AccountRoomDepsProvider deps={fixture.deps}>
          <ReviewFeed initialPage={page} emptyAction={<span>Write the first review</span>} />
        </AccountRoomDepsProvider>,
      );
      expectClean(container, VERIFIED_REVIEW.body, VERIFIED_REVIEW.authorName);
      unmount();
    }

    const { container } = render(
      <AccountRoomDepsProvider deps={fixtureAccountDeps().deps}>
        <ReviewFeed initialPage={verifiedPage} emptyAction={<span>Write the first review</span>} />
      </AccountRoomDepsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "What is a verified reviewer?" }));
    expectClean(container, VERIFIED_REVIEW.body, VERIFIED_REVIEW.authorName);
  });
});
