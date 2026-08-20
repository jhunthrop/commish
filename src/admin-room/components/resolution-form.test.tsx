import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { AdminRoomDepsProvider } from "../hooks/deps";
import { fixtureAdminDeps, renderInAdmin } from "../test-fixtures";
import { ResolutionForm, type DecisionPreview } from "./resolution-form";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

const PREVIEWS: Readonly<Record<"warned_user" | "content_removed", DecisionPreview>> = {
  warned_user: {
    title: "An operator left you a note",
    body: "Somebody reported something you posted in Sunday Money. An operator read it, decided to leave your post up, and wrote you this note. There is no reply to this message.",
  },
  content_removed: {
    title: "We removed your review",
    body: "An operator removed your review. We keep your review on file exactly as you wrote it.",
  },
};

describe("ResolutionForm", () => {
  it("previews silence for no_action, in both themes, axe-clean", async () => {
    const fixture = fixtureAdminDeps();
    await inBothThemes(
      <AdminRoomDepsProvider deps={fixture.deps}>
        <ResolutionForm flagId="flag_1" decisions={["no_action", "warned_user"]} noteMaxLength={500} previews={PREVIEWS} />
      </AdminRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByText(/will not be told/)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("previews the operator's own words verbatim for warned_user, live as they type", async () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(<ResolutionForm flagId="flag_1" decisions={["no_action", "warned_user"]} noteMaxLength={500} previews={PREVIEWS} />, fixture.deps);

    fireEvent.click(screen.getByRole("radio", { name: "Warn the member" }));
    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "Keep it civil." } });

    expect(screen.getByText('"Keep it civil."')).toBeInTheDocument();
    expect(screen.getByText(PREVIEWS.warned_user!.body)).toBeInTheDocument();
  });

  it("previews the generic removal phrase for content_removed, not the operator's own words", async () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(<ResolutionForm flagId="flag_1" decisions={["content_removed"]} noteMaxLength={500} previews={PREVIEWS} />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "This is spam, obviously." } });

    expect(screen.getByText('"breaking the review rules"')).toBeInTheDocument();
    expect(screen.queryByText('"This is spam, obviously."')).not.toBeInTheDocument();
  });

  it("submits the chosen decision and note, and shows the recorded state — no retry, no edit", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { flagId: "flag_1", decision: "no_action" } });
    renderInAdmin(<ResolutionForm flagId="flag_1" decisions={["no_action"]} noteMaxLength={500} previews={PREVIEWS} />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "Looked into it." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit decision" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Decision recorded."));
    expect(fixture.calls).toEqual(["POST /api/admin/flags/flag_1/resolve"]);
    expect(refresh).toHaveBeenCalled();
  });

  it("states the failure and lets the operator try again, without pretending it worked", async () => {
    const fixture = fixtureAdminDeps({ ok: false, error: "That flag was already resolved as \"no action\"." });
    renderInAdmin(<ResolutionForm flagId="flag_1" decisions={["no_action"]} noteMaxLength={500} previews={PREVIEWS} />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Submit decision" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("already resolved"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
