import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    body: "An operator removed your review. We keep your review on file exactly as you wrote it. There is no reply to this message.",
  },
};

describe("ResolutionForm", () => {
  it("previews silence for no_action, in both themes, axe-clean", async () => {
    const fixture = fixtureAdminDeps();
    await inBothThemes(
      <AdminRoomDepsProvider deps={fixture.deps}>
        <ResolutionForm flagId="flag_1" decisions={["no_action", "warned_user"]} noteMaxLength={500} previews={PREVIEWS} isChatSubject={false} />
      </AdminRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByText(/will not be told/)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("previews the operator's own words verbatim for warned_user, live as they type", async () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(<ResolutionForm flagId="flag_1" decisions={["no_action", "warned_user"]} noteMaxLength={500} previews={PREVIEWS} isChatSubject={false} />, fixture.deps);

    fireEvent.click(screen.getByRole("radio", { name: "Warn the member" }));
    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "Keep it civil." } });

    expect(screen.getByText('"Keep it civil."')).toBeInTheDocument();
    expect(screen.getByText(PREVIEWS.warned_user!.body)).toBeInTheDocument();
  });

  it("previews the generic removal phrase for content_removed, not the operator's own words", async () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(<ResolutionForm flagId="flag_1" decisions={["content_removed"]} noteMaxLength={500} previews={PREVIEWS} isChatSubject={false} />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "This is spam, obviously." } });

    expect(screen.getByText('"breaking the review rules"')).toBeInTheDocument();
    expect(screen.queryByText('"This is spam, obviously."')).not.toBeInTheDocument();
  });

  /**
   * Fix round 1 (review HIGH): the preview must show the phrase the CHAT author will actually
   * read, not reviews' own copy — the two domains' generic fallback differs deliberately
   * (`chatRemovalPhraseFor`, `@/moderation/removal`).
   */
  it("previews the CHAT-domain generic removal phrase for content_removed when the subject is a chat message", async () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(
      <ResolutionForm flagId="flag_1" decisions={["content_removed"]} noteMaxLength={500} previews={PREVIEWS} isChatSubject />,
      fixture.deps,
    );

    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "This is spam, obviously." } });

    expect(screen.getByText('"breaking the chat rules"')).toBeInTheDocument();
    expect(screen.queryByText('"breaking the review rules"')).not.toBeInTheDocument();
  });

  it("submits the chosen decision and note, and shows the recorded state — no retry, no edit", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { flagId: "flag_1", decision: "no_action" } });
    renderInAdmin(<ResolutionForm flagId="flag_1" decisions={["no_action"]} noteMaxLength={500} previews={PREVIEWS} isChatSubject={false} />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "Looked into it." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit decision" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Decision recorded."));
    expect(fixture.calls).toEqual(["POST /api/admin/flags/flag_1/resolve"]);
    expect(refresh).toHaveBeenCalled();
  });

  it("switches the note counter's cap with the decision — 200 for content_removed (REVIEW_CONFIG.removalReason.maxLength), 500 otherwise (fix round 1, FIX 4)", () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(<ResolutionForm flagId="flag_1" decisions={["warned_user", "content_removed"]} noteMaxLength={500} previews={PREVIEWS} isChatSubject={false} />, fixture.deps);

    // `warned_user` is `decisions[0]`, the form's default selection — the general 500 cap.
    expect(screen.getByText("500 characters left")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Remove the content" }));
    expect(screen.getByText("200 characters left")).toBeInTheDocument();
    expect(screen.queryByText("500 characters left")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Warn the member" }));
    expect(screen.getByText("500 characters left")).toBeInTheDocument();
  });

  it("re-derives the counter's cap from the switched decision even with text already typed", () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(<ResolutionForm flagId="flag_1" decisions={["warned_user", "content_removed"]} noteMaxLength={500} previews={PREVIEWS} isChatSubject={false} />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "x".repeat(210) } });
    expect(screen.getByText("290 characters left")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Remove the content" }));
    // 210 typed characters past a 200 cap: over the limit, not a negative "characters left".
    expect(screen.getByText("10 over the limit")).toBeInTheDocument();
  });

  it("walks the primary resolve flow keyboard-only: choose a decision, write a note, submit (fix round 1, FIX 6)", async () => {
    const user = userEvent.setup();
    const fixture = fixtureAdminDeps({ ok: true, data: { flagId: "flag_1", decision: "warned_user" } });
    renderInAdmin(<ResolutionForm flagId="flag_1" decisions={["no_action", "warned_user"]} noteMaxLength={500} previews={PREVIEWS} isChatSubject={false} />, fixture.deps);

    // Tab lands on the checked (default-selected) radio — native roving-tabindex, one stop for
    // the whole group — then the arrow key, not a second Tab, moves within it and changes the
    // selection, exactly how a keyboard-only operator drives a native radiogroup.
    await user.tab();
    expect(screen.getByRole("radio", { name: "No action" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "Warn the member" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "Warn the member" })).toBeChecked();

    // Out of the radio group, into the note field, typed with no pointer at all.
    await user.tab();
    expect(screen.getByLabelText("Your note")).toHaveFocus();
    await user.keyboard("Keep it civil.");
    expect(screen.getByText('"Keep it civil."')).toBeInTheDocument();

    // Tab to Submit and activate it with Enter — no click anywhere in this test.
    await user.tab();
    expect(screen.getByRole("button", { name: "Submit decision" })).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Decision recorded."));
    expect(fixture.calls).toEqual(["POST /api/admin/flags/flag_1/resolve"]);
  });

  it("states the failure and lets the operator try again, without pretending it worked", async () => {
    const fixture = fixtureAdminDeps({ ok: false, error: "That flag was already resolved as \"no action\"." });
    renderInAdmin(<ResolutionForm flagId="flag_1" decisions={["no_action"]} noteMaxLength={500} previews={PREVIEWS} isChatSubject={false} />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Submit decision" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("already resolved"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
