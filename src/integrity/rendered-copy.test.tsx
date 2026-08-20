import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { NoticeInbox } from "@/account-room/components/notice-inbox";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";
import type { NoticeView } from "@/account-room/contract";
import { ActivityFeed } from "@/league-room/components/activity-feed";
import type { ActivityRow } from "@/integrity/activity-view";
import { copyViolations } from "./copy-rules";

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
  subject: { kind: "review" as const, reviewId: "r1", body: "Great season overall.", authorName: "Ada Lovelace" },
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
      const page = await AdminQueuePage();
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

    for (const detail of [
      FLAG_DETAIL,
      { ...FLAG_DETAIL, resolution: { decision: "no_action" as const, note: "n", resolvedAt: "2026-08-02T00:00:00.000Z", resolvedByUserId: "u_op" }, decisions: [] },
      { ...FLAG_DETAIL, reporters: [], trail: [] },
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
