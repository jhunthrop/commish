import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureAccountDeps, renderInAccount } from "../test-fixtures";
import { AccountRoomDepsProvider } from "../hooks/deps";
import { ExclusionPanel } from "./exclusion-panel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

describe("ExclusionPanel", () => {
  it("offers to close paid play, supportively, when not excluded, axe-clean in both themes", async () => {
    const fixture = fixtureAccountDeps();
    await renderSurface(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <ExclusionPanel selfExcludedAt={null} />
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByRole("button", { name: "Close paid play on this account" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("never submits without a real confirm step: clicking the door does not call the API", () => {
    const fixture = fixtureAccountDeps();
    renderInAccount(<ExclusionPanel selfExcludedAt={null} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Close paid play on this account" }));
    expect(fixture.calls).toEqual([]);
  });

  it("opens a real confirm dialog before doing anything irreversible, and can be canceled with no call made", async () => {
    const fixture = fixtureAccountDeps();
    renderInAccount(<ExclusionPanel selfExcludedAt={null} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Close paid play on this account" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Once closed, only support can reopen it.");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fixture.calls).toEqual([]);
  });

  it("confirms, posts the exclusion, and refreshes on success", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { selfExcludedAt: "2026-09-01T00:00:00.000Z" } });
    renderInAccount(<ExclusionPanel selfExcludedAt={null} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Close paid play on this account" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Yes, close paid play" }));

    await waitFor(() => expect(fixture.calls).toEqual(["POST /api/wallet/exclusion"]));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows a supportive, non-accusatory notice with no action once already excluded", async () => {
    await renderSurface(<ExclusionPanel selfExcludedAt="2026-06-01T12:00:00.000Z" />, ({ getByText, queryByRole }) => {
      expect(getByText(/You closed paid play on this account/)).toBeInTheDocument();
      expect(getByText(/only support can reopen it/)).toBeInTheDocument();
      expect(queryByRole("button", { name: "Close paid play on this account" })).not.toBeInTheDocument();
    });
  });
});
