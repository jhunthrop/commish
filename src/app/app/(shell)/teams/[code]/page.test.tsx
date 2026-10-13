import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShellLeaguesProvider } from "@/components/app-shell/shell-leagues";
import { EMPTY_TEAM, FULL_TEAM } from "@/teams/test-fixtures";

// Route-level: the page's own gate, its canonical-URL rule and its one read, every DB-backed call
// stubbed; `notFound()` and `redirect()` stay the REAL `next/navigation` implementations (plain
// synchronous throws carrying a digest, no request context required), so a redirect proven here
// is the one a browser would follow.
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@research-ts/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/teams/service", () => ({ teamPage: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, usePathname: () => "/app/teams/DET" };
});

import { requireCurrentUser } from "@/lib/auth/current-user";
import { teamPage } from "@/teams/service";
import TeamPage, { generateMetadata } from "./page";

const USER = { id: "u1", email: "u1@test.local", displayName: "Ada Lovelace", experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-01T00:00:00.000Z", isAdmin: false };

const callPage = (code: string) => TeamPage({ params: Promise.resolve({ code }) });

beforeEach(() => {
  vi.mocked(requireCurrentUser).mockResolvedValue(USER);
  vi.mocked(teamPage).mockReset();
});

describe("TeamPage", () => {
  it("renders the club's page for its canonical code, reading it once", async () => {
    vi.mocked(teamPage).mockResolvedValue(FULL_TEAM);
    const page = await callPage("DET");
    render(<ShellLeaguesProvider leagueIds={["lg1"]}>{page}</ShellLeaguesProvider>);
    expect(screen.getByRole("heading", { level: 1, name: "Detroit Lions" })).toBeInTheDocument();
    expect(teamPage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(teamPage).mock.calls[0]?.[1]).toBe("DET");
  });

  it("redirects the second spelling to the canonical URL before any read", async () => {
    await expect(callPage("LA")).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT;replace;/app/teams/LAR") });
    await expect(callPage("WAS")).rejects.toMatchObject({ digest: expect.stringContaining("/app/teams/WSH") });
    expect(teamPage).not.toHaveBeenCalled();
  });

  it("404s a code neither feed has ever used, and a club the read answers null for", async () => {
    await expect(callPage("ZZZ")).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404") });
    vi.mocked(teamPage).mockResolvedValue(null);
    await expect(callPage("DET")).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404") });
  });

  it("renders a club with nothing held as headings and absences", async () => {
    vi.mocked(teamPage).mockResolvedValue(EMPTY_TEAM);
    render(<ShellLeaguesProvider leagueIds={[]}>{await callPage("TEN")}</ShellLeaguesProvider>);
    expect(screen.getByRole("heading", { level: 1, name: "Tennessee Titans" })).toBeInTheDocument();
    expect(screen.queryAllByRole("table")).toHaveLength(0);
  });

  it("names the club in the tab, and stays generic for a code it cannot name", async () => {
    expect(await generateMetadata({ params: Promise.resolve({ code: "DET" }) })).toEqual({ title: "Detroit Lions" });
    expect(await generateMetadata({ params: Promise.resolve({ code: "ZZZ" }) })).toEqual({ title: "Team" });
  });
});
