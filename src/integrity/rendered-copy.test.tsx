import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { NOTICE_INBOX_SIZE, NoticeInbox } from "@/account-room/components/notice-inbox";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { fixtureAccountDeps, PROFILE } from "@/account-room/test-fixtures";
import { NoticesProvider } from "@/components/app-shell/notices-provider";
import type { NoticeView } from "@/account-room/contract";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { fixtureChatDeps } from "@/chat-room/test-fixtures";
import { ActivityFeed } from "@/league-room/components/activity-feed";
import type { ActivityRow } from "@/integrity/activity-view";
import { noLongerHeldExplanationFor } from "@/integrity/queue-view";
import type { TradeProposalView } from "@/trades/contract";
import type { ValuedPlayer } from "@/trades/fairness";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { DRAFT_SCHEDULE, HOME, LINEUP, PUBLIC_LEAGUES, TERMS, fixtureLeagueDeps } from "@/league-room/test-fixtures";
import { AttentionQueue, attentionQueueItemsFrom } from "@/league-room/components/attention-queue";
import { DraftSchedulePanel } from "@/league-room/components/draft-schedule-panel";
import { FirstRunPanel } from "@/league-room/components/first-run-panel";
import { firstRunPlan } from "@/identity";
import { WaitingRoom, type WaitingRoomLeague } from "@/league-room/components/waiting-room";
import { FrontDoorHero } from "@/league-room/components/front-door-hero";
import { LeagueBoard } from "@/league-room/components/league-board";
import { LeagueHome } from "@/league-room/components/league-home";
import { LeagueTermsPanel } from "@/league-room/components/league-terms-panel";
import { LiveStatePill } from "@/league-room/components/live-state-pill";
import { ModerationSummary } from "@/league-room/components/moderation-summary";
import { OpenLeagueCard } from "@/league-room/components/open-league-card";
import { OpenSeatsPanel } from "@/league-room/components/open-seats-panel";
import { Wire } from "@/league-room/components/wire";
import type { PublicLeagueSummary, WireItem } from "@/matchmaking/contract";
import { FrontDoorLowerThird } from "@/league-room/components/front-door-lower-third";
import { OpenLeagueShelf } from "@/league-room/components/public-league-list";
import { SeatHoldPanel } from "@/league-room/components/seat-hold-panel";
import { SeatTakenPanel } from "@/league-room/components/seat-taken-panel";
import { TradeCard } from "@/league-room/components/trade-card";
import { TradeComposer } from "@/league-room/components/trade-composer";
import type { HomeLeagueCard, ModerationSummaryView, TradeRoomContext } from "@/league-room/contract";
import { ReviewFeed } from "@/account-room/components/review-feed";
import { InviteLanding, type InviteLandingState } from "@/league-room/components/invite-landing";
import { ManagerHeader } from "@/account-room/components/manager-header";
import { ThemeSwitcher } from "@/account-room/components/theme-switcher";
import { ThemeProvider } from "@/design/theme-provider";
import type { ReviewsPage, ReviewView } from "@/reviews/contract";
import { Crest } from "@/components/ui/crest";
import { NOT_STARTED_DASH } from "@/components/ui";
import { Meter } from "@/components/ui/meter";
import { Panel } from "@/components/ui/panel";
import { SeatMeter } from "@/components/ui/seat-meter";
import { StatPill } from "@/components/ui/stat-pill";
import { WalletPanel } from "@/account-room/components/wallet-panel";
import { DepositForm } from "@/account-room/components/deposit-form";
import { WithdrawalForm } from "@/account-room/components/withdrawal-form";
import { KycPanel } from "@/account-room/components/kyc-panel";
import { ExclusionPanel } from "@/account-room/components/exclusion-panel";
import type { MethodDescriptor } from "@/payments-provider/contract";
import { QueueTable } from "@/admin-room/components/queue-table";
import { ExclusionControl } from "@/admin-room/components/exclusion-control";
import { MockResults } from "@/draft-room/components/mock-results";
import { PracticeBanner } from "@/draft-room/components/practice-banner";
import { RoomTour } from "@/draft-room/components/room-tour";
import { ShareLinkPanel } from "@/draft-room/components/share-link-panel";
import { MOCK_RESULTS_COPY, PLAYERS, SNAKE_VIEW, TEAMS } from "@/draft-room/test-fixtures";
import { formatAbsoluteTime } from "@/league/terms";
import { formatDraftAbsolute } from "@/league-room/lib/format";
import { MOCK_COPY } from "@/mock-draft/config";
import type { MockRoomSummary } from "@/mock-draft-service/lobby";
import { MockLobby } from "@/league-room/components/mock-lobby";
import { MockSetupForm } from "@/league-room/components/mock-setup-form";
import { MockShareLanding } from "@/league-room/components/mock-share-landing";
import { PracticeEntryLink } from "@/league-room/components/practice-entry-link";
import { SignInLink } from "@/components/app-shell/sign-in-link";
import { PublicBar } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import { AppShellSkeleton } from "@/components/app-shell/app-shell-skeleton";
import { SessionNotice } from "@/components/app-shell/session-notice";
import { fetchWithSessionWatch } from "@/components/app-shell/session-watch";
import Link from "next/link";
import { SEAT_HOLD_REFUSALS } from "@/matchmaking/seat-hold";
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
          <NoticesProvider>
            <NoticeInbox />
          </NoticesProvider>
        </AccountRoomDepsProvider>,
      );
      const trigger = await within(container).findByRole("button", { name: /^Notices/ });
      expectClean(container, NOTICE.title, NOTICE.body);

      fireEvent.click(trigger);
      await waitFor(() => expectClean(container, NOTICE.title, NOTICE.body));
      unmount();
    }
  });

  /**
   * `NOTICE_INBOX_SIZE` (`@/account-room/components/notice-inbox`) is a duplicate of
   * `INTEGRITY_CONFIG.notices.inboxSize`, not an import of it — `@/integrity` is blocked from
   * `src/account-room/**` outright, tests included (the client boundary rule). This is the one
   * file positioned to hold both values at once, so it is the one that proves a future change to
   * either number cannot silently drift from the other.
   */
  it("states the same notice cap the account room's own duplicate constant claims", () => {
    expect(NOTICE_INBOX_SIZE).toBe(INTEGRITY_CONFIG.notices.inboxSize);
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
// Task 18's account room: `/app/profile` reads through all four of these directly, the same
// "call the Server Component, mock its data seams" shape this file already uses for the league
// activity and admin pages.
vi.mock("@/identity-service/profile", () => ({ readProfile: vi.fn() }));
vi.mock("@/identity-service/preferences", () => ({ readPreferences: vi.fn() }));
vi.mock("@/review-service/reviews", () => ({ myReview: vi.fn() }));
vi.mock("@/league-service/participation", () => ({ completedSeasonsFor: vi.fn() }));
// `ResolutionForm` (Task 5, `src/admin-room/components/resolution-form.tsx`) calls `useRouter()`
// for its post-submit `router.refresh()` — `notFound()` needs no request context (a plain
// synchronous throw), so it stays real; `useRouter()` is the one export this file mocks.
// `usePathname()` joins it for Task 16's `SessionNotice`, which reads the current path with no
// Next router context to fall back to in a plain component render.
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/app/leagues/league_1" };
});

describe("the league activity page says nothing that breaks the house copy rules", () => {
  it("is clean with and without a platform-action band", async () => {
    const { requireCurrentUser } = await import("@/lib/auth/current-user");
    const { resolveLeagueMembership } = await import("@/lib/leagues/membership");
    const { leagueNameFor } = await import("@/draft-service/teams");
    const { listLeagueActivity } = await import("@/integrity-service/activity");
    const { listNotices } = await import("@/integrity-service/notify");
    const { default: LeagueActivityPage } = await import("@/app/app/(shell)/leagues/[leagueId]/activity/page");

    vi.mocked(requireCurrentUser).mockResolvedValue({
      id: "u1", email: "u1@test.local", displayName: "Ada Lovelace", experienceTier: "beginner", avatarUrl: null,
      createdAt: "2026-08-01T00:00:00.000Z", isAdmin: false,
    });
    vi.mocked(resolveLeagueMembership).mockResolvedValue({
      ok: true,
      membership: { leagueId: "league_1", teamId: "team_1", isCommissioner: false, authority: { kind: "member", userId: "someone_else" } },
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
      const { container, unmount } = render(
        <AccountRoomDepsProvider deps={fixture.deps}>
          <NoticesProvider>{page}</NoticesProvider>
        </AccountRoomDepsProvider>,
      );
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
  it("is clean empty, clean populated, and clean with a Load more page", async () => {
    const { requireAdmin } = await import("@/lib/auth/current-user");
    const { listPendingFlags } = await import("@/integrity-service/flags");
    const { default: AdminQueuePage } = await import("@/app/app/(shell)/admin/queue/page");

    vi.mocked(requireAdmin).mockResolvedValue(OPERATOR);

    for (const page of [
      { rows: [], nextBefore: null },
      { rows: [QUEUE_ROW], nextBefore: null },
      // Task 19: the `Load more` link is server-composed copy (the page's own `nextHref`,
      // handed down to `QueueTable` as a plain string) — no rendered-sweep case reached it
      // before this, since every other case in this loop pages to `nextBefore: null`.
      { rows: [QUEUE_ROW], nextBefore: { raisedAt: "2026-08-02T00:00:00.000Z", id: "flag_2" } },
    ]) {
      vi.mocked(listPendingFlags).mockResolvedValue(page);
      const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
      const rendered = await AdminQueuePage({ searchParams: Promise.resolve({}) });
      const { container, unmount } = render(
        <AccountRoomDepsProvider deps={fixture.deps}>
          <NoticesProvider>{rendered}</NoticesProvider>
        </AccountRoomDepsProvider>,
      );
      await screen.findByText("Dispute queue");
      expectClean(container, QUEUE_ROW.question, QUEUE_ROW.about);
      unmount();
    }
  });
});

/**
 * `QueueTable` (Task 19, `src/admin-room/components/queue-table.tsx`) rendered directly, the
 * same "own component, own `describe` block" precedent `ResolutionForm`'s and `HeldTradeDetail`'s
 * blocks below already set — the admin queue page block above already renders it indirectly, but
 * a direct render proves the component clean on its own, independent of whatever the page around
 * it happens to pass.
 */
describe("QueueTable says nothing that breaks the house copy rules", () => {
  it("is clean empty, populated, and with a Load more page", () => {
    for (const element of [
      <QueueTable key="empty" rows={[]} />,
      <QueueTable key="populated" rows={[QUEUE_ROW]} />,
      <QueueTable key="paged" rows={[QUEUE_ROW]} nextHref="/app/admin/queue?before=x" />,
    ]) {
      const { container, unmount } = render(element);
      expectClean(container, QUEUE_ROW.question, QUEUE_ROW.about);
      unmount();
    }
  });
});

/**
 * `ExclusionControl` (Task 7, `src/admin-room/components/exclusion-control.tsx`) rendered
 * directly, the same "own component, own `describe` block" precedent `QueueTable`'s block above
 * sets — empty, erroring (both the empty-field guard and a server-stated refusal), and confirmed.
 */
describe("ExclusionControl says nothing that breaks the house copy rules", () => {
  it("is clean empty, erroring, and confirmed", async () => {
    const { fixtureAdminDeps, renderInAdmin } = await import("@/admin-room/test-fixtures");

    const empty = fixtureAdminDeps();
    const emptyRender = renderInAdmin(<ExclusionControl key="empty" />, empty.deps);
    expectClean(emptyRender.container);

    fireEvent.click(screen.getByRole("button", { name: "Clear self exclusion" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expectClean(emptyRender.container);
    emptyRender.unmount();

    const refused = fixtureAdminDeps({ ok: false, error: '"u1" is not a user, or is not excluded.' });
    const refusedRender = renderInAdmin(<ExclusionControl key="refused" />, refused.deps);
    fireEvent.change(screen.getByLabelText("Member user id"), { target: { value: "u1" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear self exclusion" }));
    await screen.findByRole("alert");
    expectClean(refusedRender.container, '"u1" is not a user, or is not excluded.');
    refusedRender.unmount();

    const cleared = fixtureAdminDeps((_url: string, init: RequestInit | undefined) =>
      (init?.method ?? "GET") === "GET"
        ? { ok: true, data: { userId: "u1", displayName: "Uno", selfExcludedAt: "2026-05-01T00:00:00.000Z" } }
        : { ok: true, data: { userId: "u1" } },
    );
    const clearedRender = renderInAdmin(<ExclusionControl key="cleared" />, cleared.deps);
    fireEvent.change(screen.getByLabelText("Member user id"), { target: { value: "u1" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear self exclusion" }));
    const dialog = await screen.findByRole("dialog");
    expectClean(clearedRender.container, "Uno");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear exclusion for Uno" }));
    await screen.findByRole("status");
    expectClean(clearedRender.container, "Uno");
    clearedRender.unmount();
  });
});

describe("the admin flag detail page says nothing that breaks the house copy rules", () => {
  it("is clean open, resolved, and with every panel empty", async () => {
    const { requireAdmin } = await import("@/lib/auth/current-user");
    const { flagDetail } = await import("@/integrity-service/flags");
    const { leagueNameFor } = await import("@/draft-service/teams");
    const { default: AdminFlagDetailPage } = await import("@/app/app/(shell)/admin/queue/[flagId]/page");

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
      const { container, unmount } = render(
        <AccountRoomDepsProvider deps={fixture.deps}>
          <NoticesProvider>{page}</NoticesProvider>
        </AccountRoomDepsProvider>,
      );
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
    const { default: AdminFlagDetailPage } = await import("@/app/app/(shell)/admin/queue/[flagId]/page");

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
      noLongerHeldExplanation: null,
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
      // Final review F4: the open-flag-but-no-decision-left state, each of the three sentences it
      // can render. Swept here because the state is reachable in production (a superseded held
      // trade before the closing sweep runs; a decision whose flag stamp failed after the trade
      // transaction committed) and the copy is server-composed, which the source scans are blind
      // to by construction.
      ...(["superseded", "accepted", "blocked"] as const).map((status) => ({
        ...HELD_DETAIL,
        subject: { ...HELD_TRADE_SUBJECT, noLongerHeldExplanation: noLongerHeldExplanationFor(status) },
        decisions: [] as const,
      })),
      {
        ...HELD_DETAIL,
        resolution: { decision: "trade_blocked" as const, note: "Both teams belong to one person.", resolvedAt: "2026-08-02T00:00:00.000Z", resolvedByUserId: "u_op", resolvedByName: "Op Erator" },
        decisions: [],
      },
    ]) {
      vi.mocked(flagDetail).mockResolvedValue(detail);
      const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
      const page = await AdminFlagDetailPage({ params: Promise.resolve({ flagId: "flag_1" }) });
      const { container, unmount } = render(
        <AccountRoomDepsProvider deps={fixture.deps}>
          <NoticesProvider>{page}</NoticesProvider>
        </AccountRoomDepsProvider>,
      );
      await screen.findByText("Held trade");
      expectClean(container, "Bijan Robinson", "Justin Jefferson", "Bay Bandits Owner", "Iron Owls Owner", "Both teams belong to one person.");
      unmount();
    }
  });

  it("is clean with a note typed and on both confirmation dialogs", async () => {
    const { requireAdmin } = await import("@/lib/auth/current-user");
    const { flagDetail } = await import("@/integrity-service/flags");
    const { leagueNameFor } = await import("@/draft-service/teams");
    const { default: AdminFlagDetailPage } = await import("@/app/app/(shell)/admin/queue/[flagId]/page");

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
        noLongerHeldExplanation: null,
      },
      reporters: [],
      trail: [],
      decisions: ["trade_released", "trade_blocked"] as const,
    };
    vi.mocked(flagDetail).mockResolvedValue(detail);
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    const page = await AdminFlagDetailPage({ params: Promise.resolve({ flagId: "flag_1" }) });
    const { container } = render(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <NoticesProvider>{page}</NoticesProvider>
      </AccountRoomDepsProvider>,
    );
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
   * above only ever wrap `AccountRoomDepsProvider` and `NoticesProvider` (for `TopBar`'s own
   * notice inbox), never `AdminRoomDepsProvider` — so a click-to-Confirm through the full page
   * would have hit a REAL network call and landed on the ERROR state, not the done one, proving
   * nothing about this sentence either way.
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
            noLongerHeldExplanation: null,
          }}
          trail={[]}
          decisions={["trade_released", "trade_blocked"]}
          noteMaxLength={500}
        />
      </AdminRoomDepsProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: buttonLabel }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: buttonLabel }));
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
    me: [{ playerId: "p1", name: "Bijan Robinson", position: "RB", nflTeam: "ATL", headshotUrl: null, adp: null }],
    them: [{ playerId: "p2", name: "Puka Nacua", position: "WR", nflTeam: "ATL", headshotUrl: null, adp: null }],
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
 * Task 6, fix round 1 (review LOW). `LeagueTermsPanel`, `OpenLeagueShelf`, `DraftSchedulePanel`
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

describe("OpenLeagueShelf says nothing that breaks the house copy rules, including each card's composed draft time", () => {
  // Task 6: the merged shelf's OWN voice grew — the shelf head, the collapsed house sentence
  // (`HOUSE_SHELF_SENTENCE`, Task 13), the legend line (`OPEN_LEAGUE_LEGEND`) and the composed
  // `seatCountsAsOfSentence` all render here and are all swept here, left IN the scanned text
  // rather than subtracted. Task 13's `LeagueRow` rendering (the lg+ form, column header
  // included) is part of this same render, so its copy is swept here too.
  const AS_OF = "Saturday 12 September, 7:42 PM UTC";
  // "The Longshot League" is `houseLeagueName("open_12", 3)`'s real output (founder directive
  // 2026-08-26's fun-name pass) — not the retired "Open 12-team League 3" shape.
  const HOUSE = { ...PUBLIC_LEAGUES[0]!, id: "house_sweep", name: "The Longshot League", houseRung: "open_12" as const };
  it("is clean signed in, signed out, house-shelved, and empty", () => {
    for (const element of [
      <OpenLeagueShelf key="signed-in" house={[HOUSE]} leagues={PUBLIC_LEAGUES} signedIn={true} asOfTime={AS_OF} />,
      <OpenLeagueShelf key="signed-out" house={[HOUSE]} leagues={PUBLIC_LEAGUES} signedIn={false} asOfTime={AS_OF} />,
      <OpenLeagueShelf key="empty" house={[]} leagues={[]} signedIn={true} asOfTime={AS_OF} />,
    ]) {
      const { container, unmount } = render(element);
      expectClean(container, ...PUBLIC_LEAGUES.map((league) => league.name), HOUSE.name);
      unmount();
    }
  });

  // 2026-08-25, the absolutism sweep's carried finding: the LIVE disclosure
  // (`MATCHMAKING_CONFIG.liveShelfStakeDisclosure`), swept on a list that mixes a free and a real
  // paid league — the exact shape that made the old blanket "no money changes hands" sentence
  // false, so this is the branch the finding exists to cover.
  it("is clean live, with a real entry fee on one listed league", () => {
    const PAID: PublicLeagueSummary = { ...PUBLIC_LEAGUES[0]!, id: "live_paid_sweep", name: "Real Stakes Sweep League", entryFeeCents: 5000 };
    const { container } = render(
      <OpenLeagueShelf house={[HOUSE]} leagues={[PAID, ...PUBLIC_LEAGUES]} signedIn={false} asOfTime={AS_OF} live />,
    );
    expectClean(container, ...PUBLIC_LEAGUES.map((league) => league.name), HOUSE.name, PAID.name);
  });
});

/**
 * Phase 3.6, Task 5. `OpenLeagueCard` is where `describeStartTiming`'s (`@/matchmaking/roll`)
 * when-full sentence and `PublicLeagueSummary.rosterSummary`/`playoffWeeks` first reach a
 * screen — none of `PUBLIC_LEAGUES` above exercises the when-full or last-seat branches, so this
 * sweeps those states explicitly rather than trusting the member-list fixture to happen to cover
 * them.
 */
describe("OpenLeagueCard says nothing that breaks the house copy rules, in every branch", () => {
  it("is clean scheduled, when-full, house-run, last-seat, beginner-only, guided, and live-chipped", () => {
    const base = PUBLIC_LEAGUES[0]!;
    // Phase 3.7, Task 5: `draftAtIso` inside the clock window puts the ticking Countdown and the
    // "On deck" chip on screen; a nearly-full card puts "Filling" on screen — both live states'
    // rendered copy is swept here, not trusted.
    const soonIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    for (const element of [
      <OpenLeagueCard key="scheduled" league={base} signedIn={false} />,
      <OpenLeagueCard key="signed-in" league={base} signedIn={true} />,
      <OpenLeagueCard key="guided" league={base} signedIn={false} />,
      <OpenLeagueCard key="when-full" league={{ ...base, id: "wf", startTrigger: "when_full" }} signedIn={false} />,
      <OpenLeagueCard key="house" league={{ ...base, id: "house1", houseRung: "open_12" }} signedIn={false} />,
      <OpenLeagueCard
        key="last-seat"
        league={{ ...base, id: "last", filledTeams: base.teamCount - 1 }}
        signedIn={false}
       
      />,
      <OpenLeagueCard key="on-deck" league={{ ...base, id: "deck", draftAtIso: soonIso }} signedIn={false} />,
      <OpenLeagueCard key="beginner" league={{ ...base, id: "beg", experienceTier: "beginner" }} signedIn={false} />,
    ]) {
      const { container, unmount } = render(element);
      expectClean(container, base.name);
      unmount();
    }
  });
});

describe("FrontDoorHero says nothing that breaks the house copy rules", () => {
  it("is clean signed in and signed out", () => {
    for (const signedIn of [true, false]) {
      const { container, unmount } = render(<FrontDoorHero signedIn={signedIn} />);
      expectClean(container);
      unmount();
    }
  });
});

describe("FrontDoorLowerThird says nothing that breaks the house copy rules, full and empty", () => {
  // Sunday v5: `ProofStrip` and `SeatClaimSteps` retired with the Direction A front door —
  // the proof numbers live in the lower third now, and this sweep moved with them.
  it("is clean with every stat present and with none of them", () => {
    for (const element of [
      <FrontDoorLowerThird
        key="full"
        stats={{ leaguesFilled: 247, roomsFillingNow: 12, rating: { average: 4.8, count: 63 }, tightestRoomSeatsRemaining: 5, any: true }}
        featuredLeague={null}
        signedIn={false}
      />,
      <FrontDoorLowerThird
        key="empty"
        stats={{ leaguesFilled: null, roomsFillingNow: null, rating: null, tightestRoomSeatsRemaining: null, any: false }}
        featuredLeague={null}
        signedIn={false}
      />,
    ]) {
      const { container, unmount } = render(element);
      expectClean(container);
      unmount();
    }
  });
});

/**
 * Phase 3.7, Task 8: the wire's composed ticker sentences — every kind, both `league_filled`
 * branches, the urgent live-tinted claim, and both coarse-time units — are runtime-composed
 * (`formatCoarseDuration` deltas stitched into each sentence), exactly the composition the
 * source sweeps are blind to, so the rendered sweep is the one that reads them. League names
 * are the content subtracted; every remaining word is the wire's own voice.
 */
describe("Wire says nothing that breaks the house copy rules, across every kind and tone", () => {
  // `draft_tonight` is retired (storefront review R1) — every kind that remains is swept.
  const WIRE_ITEMS: readonly WireItem[] = [
    { kind: "seat_claimed", leagueName: "Sunday Money", agoMs: 5 * 60_000, seatsOpen: 6 },
    { kind: "seat_claimed", leagueName: "Almost Full", agoMs: 30_000, seatsOpen: 1 },
    { kind: "league_filled", leagueName: "Iron Bowl", draftStatus: "in_progress" },
    { kind: "league_filled", leagueName: "Quiet Room", draftStatus: "scheduled" },
    { kind: "season_count", count: 76 },
  ];

  it("is clean with the full ticker rendered", () => {
    const { container } = render(<Wire items={WIRE_ITEMS} />);
    expectClean(container, "Sunday Money", "Almost Full", "Iron Bowl", "Quiet Room");
  });
});

/**
 * Phase 3.6, Task 6: the seat hold's own three screens. `SeatHoldPanel` claims a hold on mount, so
 * this sweep drives it through a real (fixtured) fetch rather than reading its loading skeleton.
 */
describe("SeatHoldPanel says nothing that breaks the house copy rules", () => {
  it("is clean held, loading, and refused", async () => {
    const held = fixtureLeagueDeps({ ok: true, data: { expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() } });
    const heldRender = render(
      <LeagueRoomDepsProvider deps={held.deps}>
        <SeatHoldPanel leagueId="lg1" leagueName="Rookie Snake Room" />
      </LeagueRoomDepsProvider>,
    );
    await screen.findByTestId("seat-hold-countdown");
    expectClean(heldRender.container, "Rookie Snake Room");
    heldRender.unmount();

    const loadingRender = render(
      <LeagueRoomDepsProvider deps={fixtureLeagueDeps(undefined, { deferred: true }).deps}>
        <SeatHoldPanel leagueId="lg1" leagueName="Rookie Snake Room" />
      </LeagueRoomDepsProvider>,
    );
    expectClean(loadingRender.container);
    loadingRender.unmount();

    const refused = fixtureLeagueDeps({ ok: false, error: SEAT_HOLD_REFUSALS.noSeat });
    const refusedRender = render(
      <LeagueRoomDepsProvider deps={refused.deps}>
        <SeatHoldPanel leagueId="lg1" leagueName="Rookie Snake Room" />
      </LeagueRoomDepsProvider>,
    );
    await screen.findByText(SEAT_HOLD_REFUSALS.noSeat);
    expectClean(refusedRender.container, SEAT_HOLD_REFUSALS.noSeat);
    refusedRender.unmount();
  });
});

describe("SeatTakenPanel says nothing that breaks the house copy rules", () => {
  it("is clean with its two actions", () => {
    const { container } = render(
      <SeatTakenPanel
        leagueName="Rookie Snake Room"
        primaryAction={<Link href="/browse">Join the next open league</Link>}
        secondaryAction={<Link href="/browse">See leagues closest to filling</Link>}
      />,
    );
    expectClean(container, "Rookie Snake Room", SEAT_HOLD_REFUSALS.taken);
  });
});

/**
 * Task 20. `InviteLanding`'s "already a member" branch composes `You are already a member of
 * ${name}.` and `Go to ${name}` at runtime — invisible to `room-copy.source.test.ts`'s own
 * blind spot the moment a caller stitches more than a template literal's static segments
 * together, so this is the sweep that reads what actually renders. Every one of the addendum's
 * nine states is driven here, "open" both signed in and out, the same discipline
 * `LeagueTermsPanel`'s own block above already sets for a composed draft time.
 */
describe("InviteLanding says nothing that breaks the house copy rules, across every one of its nine states", () => {
  it("is clean open (signed in and out), invalid, expired, exhausted, already a member, league full, draft started, and tier-refused", () => {
    const states: readonly InviteLandingState[] = [
      { kind: "open", terms: TERMS },
      { kind: "invalid" },
      { kind: "expired" },
      { kind: "exhausted" },
      { kind: "already-member", leagueId: "league_1", name: "Bay Bandits" },
      { kind: "league-full", name: "Bay Bandits" },
      { kind: "draft-started", name: "Bay Bandits" },
      { kind: "tier-refused" },
    ];
    for (const state of states) {
      for (const signedIn of [true, false]) {
        const { container, unmount } = render(<InviteLanding state={state} signedIn={signedIn} code="SUNDAY12" />);
        expectClean(container, TERMS.name, TERMS.commissionerName, "Bay Bandits");
        unmount();
      }
    }
  });
});

/**
 * Task 17: the identity card (`ProfileForm`, `variant="first-run"`) is new composed copy inside
 * an existing component — `src/account-room/**` is not itself in `room-copy.source.test.ts`'s
 * `ROOM_DIRS`, so this rendered sweep is the one thing that catches its two new sentences.
 */
describe("FirstRunPanel says nothing that breaks the house copy rules, guided and standard", () => {
  it("is clean for a beginner (explainer + identity card) and an experienced manager (no explainer)", async () => {
    const guidedBeginner = firstRunPlan({ experienceTier: "beginner", helpLevel: "guided", leagueCount: 0 })!;
    const standardExperienced = firstRunPlan({ experienceTier: "experienced", helpLevel: "standard", leagueCount: 0 })!;
    for (const plan of [guidedBeginner, standardExperienced]) {
      const fixture = fixtureLeagueDeps({ ok: true, data: {} });
      const { container, unmount } = render(
        <LeagueRoomDepsProvider deps={fixture.deps}>
          <FirstRunPanel plan={plan} profile={PROFILE} />
        </LeagueRoomDepsProvider>,
      );
      expectClean(container, PROFILE.displayName);
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
          <DraftSchedulePanel leagueId="l1" teamCount={12} isCommissioner={true} initialSchedule={schedule} />
        </LeagueRoomDepsProvider>,
      );
      expectClean(container);
      unmount();
    }

    const { container } = render(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <DraftSchedulePanel leagueId="l1" teamCount={12} isCommissioner={true} initialSchedule={scheduledLater} />
      </LeagueRoomDepsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit time" }));
    expectClean(container);
  });
});

/**
 * Phase 3.6, Task 9. `WaitingRoom` composes its own missed-draft sentence (a runtime weekday) and
 * carries `describeStartTiming`'s own composed string — neither is caught by a source sweep.
 */
describe("WaitingRoom says nothing that breaks the house copy rules, across its states", () => {
  it("is clean filling, full and counting down, rolled, missed-draft and just-seated", () => {
    const base: WaitingRoomLeague = {
      draftId: "draft_1",
      leagueId: "league_1",
      status: "scheduled",
      kickoffAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      isPublicMatchmade: true,
      startTrigger: "when_full",
      kickoffRolls: 0,
      filledTeams: 4,
      teamCount: 12,
      slotPreference: null,
      missedDraft: false,
      authority: { kind: "member", userId: "commish_1" },
    };
    for (const element of [
      <WaitingRoom key="filling" league={base} isCommissioner={true} leagueName="Sunday Money" />,
      <WaitingRoom key="full" league={{ ...base, filledTeams: 12 }} isCommissioner={true} leagueName="Sunday Money" />,
      <WaitingRoom key="rolled" league={{ ...base, startTrigger: "scheduled", kickoffRolls: 2 }} isCommissioner={true} leagueName="Sunday Money" />,
      <WaitingRoom
        key="missed"
        league={{ ...base, status: "complete", missedDraft: true, kickoffAt: "2026-08-20T12:00:00.000Z" }}
        leagueName="Sunday Money"
      />,
      <WaitingRoom key="seated" league={base} leagueName="Sunday Money" justSeated />,
      <WaitingRoom key="seated-expired-hold" league={base} leagueName="Sunday Money" justSeated holdExpired />,
    ]) {
      const { container, unmount } = render(element);
      expectClean(container, "Sunday Money");
      unmount();
    }
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
        // NOT_STARTED_DASH, subtracted for the same reason a league's own name is: it is DATA
        // handed to the surface, not copy the surface wrote. Gameday's week band renders the
        // shared `Scoreboard`, whose projected-final slot has no number to print — no weekly
        // per-player projection reaches the league layer — so it prints the product's one glyph
        // for "there is no number yet". `game-state-chip.tsx`'s own docblock is where that ruling
        // lives: *"the em-dash here is DATA, not copy — the product's no-em-dashes-in-prose rule
        // is about sentences a manager reads, and this is the absence of a number in a numeric
        // column."* The rule engine is untouched and every SENTENCE on this page is still swept;
        // what is excluded is two characters standing where two numbers will stand.
        NOT_STARTED_DASH,
        NOT_STARTED_DASH,
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
 * Task 8's other half. At the time this block was written, `account-room` carried no
 * directory-derived source sweep at all (`room-copy.source.test.ts`'s own `ROOM_DIRS` named only
 * the four client-room directories that predated it) — Task 18 closed that gap by adding
 * `src/account-room` to `ROOM_DIRS`, but this rendered sweep still owns `ReviewFeed`'s verified
 * badge, since it is composed at runtime (`review.verified`) rather than a literal the source
 * scan could ever see, the same "one place to add" shape this file's own docblock describes.
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

/**
 * Task 18, retargeted onto `ManagerHeader` when Gameday replaced `StandingPanel` with it (the
 * same three facts, promoted from a 13px caption at the bottom of the account room to the page's
 * own object). The tier sentence is still composed from props at runtime —
 * `room-copy.source.test.ts`'s own blind spot, restated in its docblock: "a string has to be both
 * composed at runtime AND unreachable at first paint to escape." This sweep drives every branch
 * that changes it: newcomer and veteran, verified and not, and 0/1/2/3 seasons, since the seasons
 * count reaches the DOM as a rendered number rather than a literal a source sweep could read.
 */
describe("ManagerHeader says nothing that breaks the house copy rules, in every branch", () => {
  it("is clean across tier, verified and every seasons count", () => {
    for (const props of [
      { seasons: 0, tier: "newcomer" as const, verified: false },
      { seasons: 1, tier: "newcomer" as const, verified: true },
      { seasons: 2, tier: "veteran" as const, verified: true },
      { seasons: 3, tier: "veteran" as const, verified: false },
    ]) {
      const { container, unmount } = render(<ManagerHeader displayName="Dana Reyes" avatar={null} email="dana@example.test" {...props} />);
      expectClean(container);
      unmount();
    }
  });
});

/**
 * Task 18. The resolution sentence is composed from `ThemePreference` AND the device's own
 * `matchMedia` read — two runtime inputs `room-copy.source.test.ts` cannot see. `happy-dom`'s own
 * `matchMedia` answers `matches: false` for every query with no explicit stub, which is what the
 * "system, resolves light" branch below relies on; the other two branches are reached by clicking
 * through the actual control, the same "driven through the real radios" discipline the resolution
 * form's own sweep above uses.
 */
describe("ThemeSwitcher says nothing that breaks the house copy rules, system, light and dark", () => {
  it("is clean on every resolution sentence", () => {
    const { container } = render(
      <ThemeProvider>
        <ThemeSwitcher />
      </ThemeProvider>,
    );
    expectClean(container);

    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expectClean(container);

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expectClean(container);
  });
});

/**
 * Task 18. The whole room, called as a Server Component with its five data seams mocked —
 * `readProfile`/`readPreferences`/`myReview`/`completedSeasonsFor` join `requireCurrentUser` —
 * the same "call the page, mock its seams" shape the league activity and admin pages above use.
 * Worth the setup: the account facts paragraph (Step 3) is exactly the kind of carefully worded,
 * once-composed string this file exists to catch, and it is assembled from `CurrentUser.email`
 * at runtime, invisible to `room-copy.source.test.ts`. Two passes — a newcomer with no review on
 * file, a verified veteran with one — cover both `ManagerHeader` branches and both `ReviewComposer`
 * states in the one page they actually share a screen with.
 */
describe("the profile page says nothing that breaks the house copy rules", () => {
  it("is clean for a newcomer with no review, and a verified veteran with one", async () => {
    const { requireCurrentUser } = await import("@/lib/auth/current-user");
    const { readProfile } = await import("@/identity-service/profile");
    const { readPreferences } = await import("@/identity-service/preferences");
    const { myReview } = await import("@/review-service/reviews");
    const { completedSeasonsFor } = await import("@/league-service/participation");
    const { default: ProfilePage } = await import("@/app/app/(shell)/profile/page");

    vi.mocked(requireCurrentUser).mockResolvedValue({
      id: "u1", email: "ada@test.local", displayName: PROFILE.displayName, experienceTier: "beginner", avatarUrl: null,
      createdAt: "2026-08-01T00:00:00.000Z", isAdmin: false,
    });
    vi.mocked(readProfile).mockResolvedValue(PROFILE);
    vi.mocked(readPreferences).mockResolvedValue({ helpLevel: "guided", draftTourDismissedAt: null });

    for (const [review, seasons] of [
      [{ state: "none" as const }, 0],
      [{ state: "live" as const, review: VERIFIED_REVIEW }, 2],
    ] as const) {
      vi.mocked(myReview).mockResolvedValue(review);
      vi.mocked(completedSeasonsFor).mockResolvedValue(seasons);
      const fixture = fixtureAccountDeps();
      const page = await ProfilePage();
      const { container, unmount } = render(
        <ThemeProvider>
          <AccountRoomDepsProvider deps={fixture.deps}>{page}</AccountRoomDepsProvider>
        </ThemeProvider>,
      );
      // The page's own <h1> is the MANAGER (Gameday law 2, `ManagerHeader`); "Your profile" is
      // now only the browser tab. Wait on the heading the page actually renders.
      await screen.findByText(PROFILE.displayName);
      expectClean(container, PROFILE.displayName, "ada@test.local", review.state === "live" ? VERIFIED_REVIEW.body : "", review.state === "live" ? VERIFIED_REVIEW.authorName : "");
      unmount();
    }
  });
});

/**
 * Phase 3.6, Task 3: the five primitives the mocks repeat join the sweep the same commit that
 * creates them, per this file's own "one place to add" point. `SeatMeter` is the one that
 * composes its own sentence at runtime (the rest render whatever a caller passes them), so it is
 * the one exercised across every branch that changes its wording.
 */
describe("SeatMeter says nothing that breaks the house copy rules, in every branch", () => {
  it("is clean with nothing left to say, with seats left, and with a hold", () => {
    for (const element of [
      <SeatMeter key="base" filled={9} total={12} />,
      <SeatMeter key="left" filled={11} total={12} />,
      <SeatMeter key="held" filled={9} total={12} heldSeats={1} />,
    ]) {
      const { container, unmount } = render(element);
      expectClean(container);
      unmount();
    }
  });
});

describe("Panel, Crest, Meter and StatPill say nothing that breaks the house copy rules", () => {
  it("is clean with the content a real caller passes each", () => {
    for (const element of [
      <Panel key="panel" title="Standings" meta="10 managers, 2 open seats">
        <p>Body content</p>
      </Panel>,
      <Crest key="crest" id="league_1" name="Bay Bandits" />,
      <Meter key="meter" label="Seats filled" value={10} max={12} />,
      <StatPill key="pill" label="In progress" tone="accent" glow />,
    ]) {
      const { container, unmount } = render(element);
      expectClean(container);
      unmount();
    }
  });
});

/**
 * Task 16. `SignInLink`, `PublicBar` and `PublicFooter` join the roster in the same commit that
 * creates them, per this file's own "one place to add" point. `SessionNotice` joins them too,
 * across BOTH states an actual dead session puts it in — the quiet strip and the escalated
 * `Modal` — since its own copy is exactly the kind of "said once, behind an interaction" text
 * this file's own docblock says a per-module sweep is likely to miss.
 */
describe("SignInLink, PublicBar and PublicFooter say nothing that breaks the house copy rules", () => {
  it("is clean with and without an intent, and with the front door's own nav and action filled in", () => {
    for (const element of [
      <SignInLink key="plain" intent={null} />,
      <SignInLink key="intent" intent="/join/league_1/hold" />,
      <PublicBar key="bare" intent="/reviews" signedIn={false} />,
      <PublicBar
        key="filled"
        signedIn={false}
        intent="/"
        nav={[
          { href: "/browse", label: "Open leagues" },
          { href: "/league-rules", label: "How it works" },
          { href: "/reviews", label: "Reviews" },
        ]}
        action={<span>Take a seat</span>}
      />,
      <PublicFooter key="footer" />,
    ]) {
      const { container, unmount } = render(element);
      expectClean(container);
      unmount();
    }
  });
});

/**
 * Phase 3.6 addendum, Task 21. `AppShellSkeleton` joins the roster in the same commit that
 * creates it, per this file's own "one place to add" point — even though its only text is the
 * fixed word "Loading" in every shape, sweeping it here is what keeps that true if a future edit
 * ever adds real copy to one of its geometries.
 */
describe("AppShellSkeleton says nothing that breaks the house copy rules, in every shape", () => {
  it("is clean content, public, and room", () => {
    for (const shape of ["content", "public", "room"] as const) {
      const { container, unmount } = render(<AppShellSkeleton shape={shape} />);
      expectClean(container);
      unmount();
    }
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("SessionNotice says nothing that breaks the house copy rules, quiet and escalated", () => {
  it("is clean idle, on the quiet strip, and on the escalated Modal", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { container: idle, unmount: unmountIdle } = render(<SessionNotice />);
    expectClean(idle);
    unmountIdle();

    fetchSpy.mockResolvedValue(jsonResponse(401, { ok: false, error: "Not authenticated." }));
    const { container: strip, unmount: unmountStrip } = render(<SessionNotice />);
    await fetchWithSessionWatch("/api/notices");
    await within(strip).findByRole("status");
    expectClean(strip);
    unmountStrip();

    const { container: modal, unmount: unmountModal } = render(<SessionNotice />);
    await fetchWithSessionWatch("/api/invites/ABC/accept", { method: "POST", body: "{}" });
    await within(modal).findByRole("dialog");
    expectClean(modal);
    unmountModal();

    fetchSpy.mockRestore();
  });
});

/**
 * Phase 3.6, Task 10: the locker room's four new components join the roster the same commit
 * that creates them, per this file's own "one place to add" point.
 */
const SWEEP_LEAGUE: HomeLeagueCard = {
  id: "l_sweep",
  name: "Sunday Money",
  format: "snake",
  teamCount: 10,
  filledTeams: 10,
  isCommissioner: false,
  myTeamId: "t1",
  draftId: "d1",
  draftStatus: "complete",
  record: { wins: 5, losses: 2, ties: 0 },
  weekNumber: 4,
  weekStatus: "scheduled",
  matchup: null,
  nextAction: { kind: "fix-lineup", label: "Fix your lineup" },
  lineupSet: false,
  medianGame: true,
  medianScore: 121.4,
  kickoffAt: null,
  startTrigger: null,
  kickoffRolls: 0,
  myTeamName: "Sunday Money Team",
};

describe("LeagueBoard says nothing that breaks the house copy rules", () => {
  it("is clean with a mix of leagues, including a median league's second result", () => {
    const { container } = render(
      <LeagueBoard
        leagues={[
          SWEEP_LEAGUE,
          {
            ...SWEEP_LEAGUE,
            id: "l_sweep_live",
            name: "Auction Night",
            weekStatus: "in_progress",
            nextAction: { kind: "watch-scores", label: "Watch the scores" },
            lineupSet: true,
            matchup: {
              weekNumber: 4,
              homeTeamId: "t1",
              awayTeamId: "t2",
              homeTeamName: "Bay Bandits",
              awayTeamName: "Iron Owls",
              homeScore: 112.5,
              awayScore: 98.25,
              final: false,
              weekStatus: "in_progress",
            },
          },
        ]}
      />,
    );
    expectClean(container, "Sunday Money", "Auction Night", "Bay Bandits", "Iron Owls");
  });
});

describe("AttentionQueue says nothing that breaks the house copy rules", () => {
  it("is clean populated and empty", () => {
    for (const element of [
      <AttentionQueue key="populated" items={attentionQueueItemsFrom([SWEEP_LEAGUE])} />,
      <AttentionQueue key="empty" items={[]} />,
    ]) {
      const { container, unmount } = render(element);
      expectClean(container, SWEEP_LEAGUE.name);
      unmount();
    }
  });
});

describe("OpenSeatsPanel says nothing that breaks the house copy rules", () => {
  it("is clean populated, empty, and quiet", () => {
    for (const element of [
      <OpenSeatsPanel key="populated" leagues={PUBLIC_LEAGUES} />,
      <OpenSeatsPanel key="quiet" leagues={PUBLIC_LEAGUES} quiet />,
      <OpenSeatsPanel key="empty" leagues={[]} />,
    ]) {
      const { container, unmount } = render(element);
      expectClean(container, ...PUBLIC_LEAGUES.map((league) => league.name));
      unmount();
    }
  });
});

describe("LiveStatePill says nothing that breaks the house copy rules", () => {
  it("is clean live and null", () => {
    for (const element of [
      <LiveStatePill key="live" liveState={{ weekday: "Sunday", gamesLive: 7 }} />,
      <LiveStatePill key="null" liveState={null} />,
    ]) {
      const { container, unmount } = render(element);
      expectClean(container);
      unmount();
    }
  });
});

/**
 * Task 12 (Phase 4, money foundations): the wallet, the account room's first user-facing money
 * surface. All five components join the roster in this one commit, per this file's own "one
 * describe block, one place to add" point.
 */
const WALLET_METHODS: readonly MethodDescriptor[] = [
  { method: "bank", feeCents: 0, feePercentBasisPoints: 0, etaDescription: "1-3 business days" },
  { method: "card", feeCents: 30, feePercentBasisPoints: 325, etaDescription: "Within minutes" },
];

describe("WalletPanel says nothing that breaks the house copy rules", () => {
  it("is clean across a fresh account and one with every figure non-zero", () => {
    for (const summary of [
      { availableCents: 0, escrowCents: 0, heldCents: 0, owedCents: 0 },
      { availableCents: 123_45, escrowCents: 20_00, heldCents: 5_00, owedCents: 10_00 },
    ]) {
      const { container, unmount } = render(<WalletPanel summary={summary} />);
      expectClean(container);
      unmount();
    }
  });
});

describe("DepositForm says nothing that breaks the house copy rules, including every refusal it can show", () => {
  it("is clean at rest, below the minimum, above the maximum, missing a state, declined, and server-refused", async () => {
    const { container, unmount } = render(
      <AccountRoomDepsProvider deps={fixtureAccountDeps().deps}>
        <DepositForm methods={WALLET_METHODS} />
      </AccountRoomDepsProvider>,
    );
    expectClean(container);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add money" }));
    expectClean(container);

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "TN" } });
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "card" } });
    expectClean(container);
    unmount();

    const declinedFixture = fixtureAccountDeps({
      ok: true,
      data: {
        transfer: {
          ref: "mock-transfer-1",
          direction: "deposit",
          amountCents: 50_00,
          status: "failed",
          failureReason: "The bank declined this transfer.",
          initiatedAt: "2026-09-01T00:00:00.000Z",
        },
      },
    });
    const { container: declinedContainer } = render(
      <AccountRoomDepsProvider deps={declinedFixture.deps}>
        <DepositForm methods={WALLET_METHODS} />
      </AccountRoomDepsProvider>,
    );
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "TN" } });
    fireEvent.click(screen.getByRole("button", { name: "Add money" }));
    await screen.findByText(/No money moved/);
    expectClean(declinedContainer);
  });
});

describe("WithdrawalForm says nothing that breaks the house copy rules, including a declined transfer", () => {
  it("is clean at rest and after a decline", async () => {
    const fixture = fixtureAccountDeps({
      ok: true,
      data: {
        transfer: {
          ref: "mock-transfer-1",
          direction: "withdrawal",
          amountCents: 5_00,
          status: "failed",
          failureReason: "The bank declined this transfer.",
          initiatedAt: "2026-09-01T00:00:00.000Z",
        },
        feeCents: 0,
        feePercentBasisPoints: 0,
        etaDescription: "1-3 business days",
      },
    });
    const { container } = render(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <WithdrawalForm bankMethod={WALLET_METHODS[0]!} />
      </AccountRoomDepsProvider>,
    );
    expectClean(container);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "TN" } });
    fireEvent.change(screen.getByLabelText("Bank account reference"), { target: { value: "acct_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await screen.findByText(/No money moved/);
    expectClean(container);
  });
});

describe("KycPanel says nothing that breaks the house copy rules, in every one of its four statuses", () => {
  it("is clean none, pending, verified and failed", () => {
    for (const status of ["none", "pending", "verified", "failed"] as const) {
      const { container, unmount } = render(
        <AccountRoomDepsProvider deps={fixtureAccountDeps().deps}>
          <KycPanel status={status} />
        </AccountRoomDepsProvider>,
      );
      expectClean(container);
      unmount();
    }
  });
});

describe("ExclusionPanel says nothing that breaks the house copy rules, excluded and not, confirm dialog included", () => {
  it("is clean not excluded, with the confirm dialog open, and already excluded", async () => {
    const { container, unmount } = render(
      <AccountRoomDepsProvider deps={fixtureAccountDeps().deps}>
        <ExclusionPanel selfExcludedAt={null} />
      </AccountRoomDepsProvider>,
    );
    expectClean(container);
    fireEvent.click(screen.getByRole("button", { name: "Close paid play on this account" }));
    await screen.findByRole("dialog");
    expectClean(container);
    unmount();

    const { container: excludedContainer, unmount: unmountExcluded } = render(<ExclusionPanel selfExcludedAt="2026-06-01T12:00:00.000Z" />);
    expectClean(excludedContainer);
    unmountExcluded();
  });
});

/**
 * Phase 4.5, Task 8. All three of the mock room's own new components carry `MOCK_COPY` text
 * ONLY as props from a server ancestor (`src/draft-room/**` cannot value-import `@/mock-draft`
 * — the client boundary), so this is the one place a stray dash, contraction or forbidden word
 * in that text would actually be caught rendered rather than at its source. The literal strings
 * below are `@/mock-draft/config`'s own `MOCK_COPY` values, copied rather than imported, for the
 * same reason: this file has no business reaching a directory `src/draft-room/**` itself cannot.
 */
describe("PracticeBanner says nothing that breaks the house copy rules", () => {
  it("is clean with the room's own practice banner text", () => {
    const message = "This is a mock draft. Nothing here counts, and this room clears itself after a day.";
    const { container } = render(<PracticeBanner message={message} />);
    expectClean(container);
  });
});

/**
 * Task 9, Step 1. `RoomTour`'s closing stop quotes C3's safety-net phrase verbatim, hardcoded in
 * `room-tour.tsx` (`src/draft-room/**` may not value-import `@/mock-draft`, its own docblock).
 * The lobby design review (2026-08-26) removed the static `MOCK_COPY` phrase this stop's second
 * half used to mirror word-for-word (replaced by a defaults-stating one-tap,
 * `soloQuickStartLabel`), so this sweep now only proves the stop is copy-clean and still says
 * what it always has, not that it matches a config value that no longer exists.
 */
describe("RoomTour says nothing that breaks the house copy rules, and never drifts from MOCK_CONFIG's own words", () => {
  // Fun pass, Task 4: the closing stop used to sell practice by leading with absolution
  // ("Even if you miss your pick..."), which put the safety net in a stop whose subject is not
  // the safety net. It now says what a mock draft IS. C3's sanctioned phrase is unaffected — the
  // clock, queue and turn stops still quote it verbatim, and the assertion below is what proves
  // this rewrite did not quietly take it out of the tour along with the sentence it moved.
  it("is clean, still sells the mock draft, and still quotes the one safety-net phrase", () => {
    const { container, getByText, getAllByText } = render(<RoomTour dismissedAt={null} onDismiss={() => {}} actionLabel="Draft" />);
    expectClean(container);
    expect(getByText(/Run a mock draft first\./)).toBeInTheDocument();
    expect(getAllByText(/the room picks for you from your queue/).length).toBeGreaterThan(0);
  });
});

describe("ShareLinkPanel says nothing that breaks the house copy rules", () => {
  it("is clean with a share code, a partial seat count and a live countdown", () => {
    const { container } = render(
      <ShareLinkPanel
        path="/app/mock-drafts/ABC123"
        shareCode="ABC123"
        seatsFilled={3}
        seatsTotal={8}
        startsAt={new Date(Date.now() + 3 * 60_000).toISOString()}
      />,
    );
    expectClean(container, "ABC123", "/app/mock-drafts/ABC123");
  });
});

const MOCK_RESULTS_VIEW = {
  ...SNAKE_VIEW,
  phase: "complete" as const,
  onClockTeamId: null,
  picks: [
    { pickNumber: 1, round: 1, teamId: "t1", playerId: "rb1", slot: "RB" as const, slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false },
  ],
  rosters: {
    t1: [
      { slot: "QB" as const, slotIndex: 0, playerId: null },
      { slot: "RB" as const, slotIndex: 0, playerId: "rb1" },
      { slot: "RB" as const, slotIndex: 1, playerId: null },
    ],
  },
};

describe("MockResults says nothing that breaks the house copy rules, with and without a team of your own", () => {
  it("is clean for a team with a roster and picks, and for a commissioner with neither", () => {
    const actions = {
      runAgain: <Link href="/app/mock-drafts?create=solo">{MOCK_RESULTS_COPY.runAgainLabel}</Link>,
      openLobby: <Link href="/app/mock-drafts">{MOCK_RESULTS_COPY.openLobbyLabel}</Link>,
      browseLeagues: <Link href="/browse">{MOCK_RESULTS_COPY.browseLeaguesLabel}</Link>,
    };
    for (const myTeamId of ["t1", null]) {
      const { container, unmount } = render(
        <MockResults teams={TEAMS} board={null} view={MOCK_RESULTS_VIEW} players={PLAYERS} myTeamId={myTeamId} copy={MOCK_RESULTS_COPY} actions={actions} />,
      );
      expectClean(container, "Marcus Reed");
      unmount();
    }
  });
});

/**
 * Task 9's own three new client components — `PracticeEntryLink`, `MockSetupForm` and `MockLobby`
 * (`src/league-room/**`) plus `MockShareLanding` (also `src/league-room/**`) — none of which may
 * value-import `@/mock-draft` either, the identical client-boundary reason `PracticeBanner`/
 * `MockResults`/`ShareLinkPanel` above are swept here rather than trusted.
 */
describe("PracticeEntryLink says nothing that breaks the house copy rules", () => {
  it("is clean signed in and signed out", () => {
    for (const signedIn of [true, false]) {
      const { container, unmount } = render(<PracticeEntryLink signedIn={signedIn} />);
      expectClean(container);
      unmount();
    }
  });
});

describe("MockSetupForm says nothing that breaks the house copy rules", () => {
  it("is clean with the real MOCK_CONFIG options threaded down as props", () => {
    const { container } = render(
      <MockSetupForm
        modes={["solo", "lobby", "link"]}
        teamCountOptions={[8, 10, 12]}
        pickSecondsOptions={[30, 60, 90]}
        defaultTeamCount={12}
        defaultPickSeconds={60}
        onCreated={() => {}}
      />,
    );
    expectClean(container);
  });
});

const MOCK_LOBBY_OPEN_ROOM = { leagueId: "l1", shareCode: "OPEN01", teamCount: 10, seatsOpen: 3, pickSeconds: 60, startsInMs: 90_000 };
const MOCK_LOBBY_MINE_ROOM = {
  leagueId: "l2",
  draftId: "d2",
  shareCode: "MINE01",
  teamCount: 8,
  seatsOpen: 0,
  pickSeconds: 30,
  startsInMs: -5_000,
  mode: "solo" as const,
  status: "in_progress" as const,
  teamName: "Mock Squad",
};
const MOCK_LOBBY_WIRE_ITEMS = [
  { kind: "mocks_running" as const, count: 3 },
  { kind: "mock_filled" as const, teamCount: 12, agoMs: 4 * 60_000 },
];

describe("MockLobby says nothing that breaks the house copy rules, empty and populated", () => {
  it("is clean with nothing open and nothing of the caller's own, and with both populated", () => {
    for (const props of [
      { initialOpen: [], initialMine: [], initialWireItems: [] },
      { initialOpen: [MOCK_LOBBY_OPEN_ROOM], initialMine: [MOCK_LOBBY_MINE_ROOM], initialWireItems: MOCK_LOBBY_WIRE_ITEMS },
    ]) {
      const { container, unmount } = render(
        <MockLobby
          {...props}
          modes={["solo", "lobby", "link"]}
          teamCountOptions={[8, 10, 12]}
          pickSecondsOptions={[30, 60, 90]}
          defaultTeamCount={12}
          defaultPickSeconds={60}
          emptyMessage={MOCK_COPY.lobbyEmptyMessage}
          historyEmptyMessage={MOCK_COPY.lobbyHistoryEmptyMessage}
        />,
      );
      expectClean(container);
      unmount();
    }
  });
});

const MOCK_SHARE_SUMMARY: MockRoomSummary = {
  leagueId: "l1",
  shareCode: "ABC123",
  teamCount: 8,
  seatsOpen: 3,
  pickSeconds: 60,
  startsInMs: 90_000,
  mode: "link",
  started: false,
  alreadySeated: false,
};

describe("MockShareLanding says nothing that breaks the house copy rules, joinable and already started", () => {
  it("is clean joinable, already seated, and started for a stranger", () => {
    for (const summary of [
      MOCK_SHARE_SUMMARY,
      { ...MOCK_SHARE_SUMMARY, alreadySeated: true },
      { ...MOCK_SHARE_SUMMARY, started: true, alreadySeated: false },
    ]) {
      const { container, unmount } = render(<MockShareLanding code="ABC123" summary={summary} />);
      expectClean(container, "ABC123");
      unmount();
    }
  });
});

/**
 * Flow analysis C-02 (2026-08-27): one league advertised two different draft DAYS — the
 * commissioner's hero read the browser's local time with no zone label while the terms panel and
 * the stranger-facing invite landing rendered UTC. The fix made the hero join the product's own
 * convention, which leaves TWO functions holding one rule: `formatAbsoluteTime` (`@/league/terms`,
 * server-only) and `formatDraftAbsolute` (`@/league-room/lib/format`, client-side — the boundary
 * forbids importing the first). Deliberate duplicates need a drift guard, or the bug returns the
 * day one of them is edited alone.
 */
describe("the draft-time rule is one rule, on both sides of the client boundary", () => {
  it("formats the identical instant identically, server and client", () => {
    for (const iso of ["2026-09-05T23:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-12-31T12:34:00.000Z"]) {
      expect(formatDraftAbsolute(iso)).toBe(formatAbsoluteTime(iso));
    }
  });
});
