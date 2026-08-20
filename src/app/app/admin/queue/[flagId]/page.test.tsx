import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";

vi.mock("@/lib/auth/current-user", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
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
  subject: { kind: "review" as const, reviewId: "r1", body: "Great season overall.", authorName: "Ada" },
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
  return render(<AccountRoomDepsProvider deps={fixture.deps}>{page}</AccountRoomDepsProvider>);
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
    await inBothThemes(
      <AccountRoomDepsProvider deps={fixture.deps}>{page}</AccountRoomDepsProvider>,
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
      subject: { kind: "chat_message" as const, messageId: "5", body: "trash talk", authorName: "Bob" },
    });
    await renderPage();

    expect(await screen.findByRole("radio", { name: "No action" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Remove the content" })).toBeInTheDocument();
  });

  it("previews the chat notice, not the review one, when removing a chat message", async () => {
    vi.mocked(flagDetail).mockResolvedValue({
      ...OPEN_REVIEW_DETAIL,
      leagueId: "l1",
      subject: { kind: "chat_message" as const, messageId: "5", body: "trash talk", authorName: "Bob" },
    });
    await renderPage();

    screen.getByRole("radio", { name: "Remove the content" }).click();
    expect(await screen.findByText("We removed one of your messages")).toBeInTheDocument();
    expect(screen.queryByText("We removed your review")).not.toBeInTheDocument();
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
    await inBothThemes(
      <AccountRoomDepsProvider deps={fixture.deps}>{page}</AccountRoomDepsProvider>,
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
