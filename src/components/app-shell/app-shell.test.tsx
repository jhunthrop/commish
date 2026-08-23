import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderSurface } from "@/components/ui/test-utils";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";
import { NoticesProvider } from "./notices-provider";
import { AppShell, type AppShellProps } from "./app-shell";
import type { RailLeague } from "./shell-data";

// `LeagueRail` reads `usePathname()` directly (ruling 8, as amended) — same mock shape
// `league-rail.test.tsx` uses.
let pathname = "/app";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

function mockPathname(next: string): void {
  pathname = next;
}

const RAIL: readonly RailLeague[] = [
  { id: "lg_bandits", name: "Bay Bandits", shortName: "BB", state: "quiet" },
  // "needs-you" is exactly "join-draft" today — "fix-lineup" does not exist until Task 10 Step
  // 1b (F1). This fixture's accessible name reflects the vocabulary this task actually ships.
  { id: "lg_volt", name: "Volt Kings", shortName: "VK", state: "needs-you" },
];

function baseProps(): AppShellProps {
  return {
    user: { displayName: "Ada Lovelace", avatar: null, isAdmin: false },
    rail: RAIL,
    liveState: null,
    children: <p>League content</p>,
  };
}

function renderShell(props: AppShellProps) {
  const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
  return render(
    <AccountRoomDepsProvider deps={fixture.deps}>
      <NoticesProvider>
        <AppShell {...props} />
      </NoticesProvider>
    </AccountRoomDepsProvider>,
  );
}

describe("AppShell", () => {
  it("renders one banner, one navigation and one main, so a screen reader hears a place", async () => {
    mockPathname("/app");
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    await renderSurface(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <NoticesProvider>
          <AppShell {...baseProps()} />
        </NoticesProvider>
      </AccountRoomDepsProvider>,
      ({ getAllByRole }) => {
        expect(getAllByRole("banner")).toHaveLength(1);
        expect(getAllByRole("navigation", { name: "Your leagues" })).toHaveLength(1);
        expect(getAllByRole("main")).toHaveLength(1);
      },
    );
  });

  it("marks the league the current URL belongs to, by aria-current and not by color", () => {
    // The rail reads the path it is standing on rather than being told: `usePathname()` is the
    // fact, and it is why the shell can live in a layout at all (ruling 8, as amended).
    mockPathname("/app/leagues/lg_bandits/matchups/3");
    const { getByRole } = renderShell(baseProps());
    expect(getByRole("link", { name: /Bay Bandits/ })).toHaveAttribute("aria-current", "page");
  });

  it("gives every crest an accessible name that is the league's real name, never its initials", () => {
    // The rail is 40px tiles reading two-letter initials. Initials are a VISUAL compression and
    // are meaningless read aloud; the accessible name is the league, and the state dot is
    // words. The action half of the name is the one string COPY owns in `next-action.ts` (C2).
    mockPathname("/app");
    const { getByRole } = renderShell(baseProps());
    expect(getByRole("link", { name: "Volt Kings. Join the draft." })).toBeInTheDocument();
  });

  it("keeps the rail reachable at 360px by becoming a horizontal strip, not by disappearing", () => {
    mockPathname("/app");
    const { getByTestId } = renderShell(baseProps());
    expect(getByTestId("league-rail").className).toMatch(/overflow-x-auto/);
    expect(getByTestId("league-rail").className).not.toMatch(/hidden/);
  });

  it("renders no max-w-* on <main> — full-bleed frames, measured paragraphs (Step 2)", () => {
    mockPathname("/app");
    const { container } = renderShell(baseProps());
    const main = container.querySelector("main")!;
    expect(main.className).not.toMatch(/max-w-/);
  });

  it("renders the caller's children inside the one <main>", () => {
    mockPathname("/app");
    const { getByText } = renderShell(baseProps());
    expect(getByText("League content")).toBeInTheDocument();
  });
});
