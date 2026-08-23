import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureAccountDeps, renderInAccount } from "../test-fixtures";
import { AccountRoomDepsProvider } from "../hooks/deps";
import { HelpLevelForm } from "./help-level-form";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

describe("HelpLevelForm", () => {
  it("shows the stored level in plain words, in both themes, axe-clean", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { helpLevel: "guided", draftTourDismissedAt: null } });
    await renderSurface(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <HelpLevelForm helpLevel="guided" />
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByLabelText("How much help")).toHaveValue("guided");
        expect(screen.getByRole("option", { name: "More help" })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: "The basics" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("PATCHes the chosen level and takes the server's answer as the truth", async () => {
    const bodies: unknown[] = [];
    const fixture = fixtureAccountDeps({ ok: true, data: { helpLevel: "standard", draftTourDismissedAt: null } });
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async (url, init) => {
        bodies.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) });
        return { json: async () => fixture.response } as unknown as Response;
      },
    };
    renderInAccount(<HelpLevelForm helpLevel="guided" />, fixture.deps);

    fireEvent.change(screen.getByLabelText("How much help"), { target: { value: "standard" } });
    await waitFor(() =>
      expect(bodies).toEqual([{ url: "/api/preferences", method: "PATCH", body: { helpLevel: "standard" } }]),
    );
    expect(screen.getByLabelText("How much help")).toHaveValue("standard");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("states a refusal rather than swallowing it", async () => {
    const fixture = fixtureAccountDeps({ ok: false, error: "Too many changes in a short time. Give it a minute and try again." });
    renderInAccount(<HelpLevelForm helpLevel="guided" />, fixture.deps);
    fireEvent.change(screen.getByLabelText("How much help"), { target: { value: "standard" } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Give it a minute and try again."));
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });
});
