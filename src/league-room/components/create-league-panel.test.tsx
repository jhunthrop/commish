import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { CreateLeaguePanel } from "./create-league-panel";

// `CreateLeaguePanel` navigates via `next/navigation`'s `useRouter` after a successful create,
// which throws outside a mounted App Router. Stubbing the hook — not the component — keeps
// this a real render of `CreateLeaguePanel`'s own composition of `CreateLeagueForm`, per the
// idiom `join-form.test.tsx` established. The calls array lets the test assert ORDER, not just
// that both were called.
const calls: string[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => calls.push("refresh"),
    push: (href: string) => calls.push(`push:${href}`),
  }),
}));

describe("CreateLeaguePanel", () => {
  it("refreshes the router and navigates to the created league, in that order", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "l9", teamId: "t1", draftId: "d1" } });
    renderInLeague(<CreateLeaguePanel />, fixture.deps);
    fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Sunday Money" } });
    fireEvent.click(screen.getByRole("button", { name: "Create league" }));
    await waitFor(() => expect(calls).toEqual(["refresh", "push:/app/leagues/l9"]));
  });
});
