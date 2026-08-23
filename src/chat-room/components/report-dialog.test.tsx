import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { CHAT_CONFIG } from "@/chat/config";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureChatDeps, renderInChat } from "../test-fixtures";
import { ReportDialog } from "./report-dialog";

describe("ReportDialog", () => {
  it("renders nothing when closed", () => {
    const { deps } = fixtureChatDeps();
    renderInChat(<ReportDialog open={false} leagueId="l1" messageId="1" onClose={() => {}} />, deps);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers every configured reason, in both themes, axe-clean", async () => {
    // No provider needed: `useChatRoomDeps()` defaults to real browser deps, and this test
    // never submits — see `useChatRoomDeps`'s own docblock.
    await renderSurface(<ReportDialog open leagueId="l1" messageId="1" onClose={() => {}} />, async ({ container }) => {
      for (const entry of CHAT_CONFIG.reportReasons) {
        expect(screen.getByRole("radio", { name: entry.label })).toBeInTheDocument();
      }
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("sends the selected reason and confirms once the report lands", async () => {
    const fixture = fixtureChatDeps();
    fixture.response = { ok: true, data: { reported: true } };
    renderInChat(<ReportDialog open leagueId="l1" messageId="42" onClose={() => {}} />, fixture.deps);

    fireEvent.click(screen.getByRole("radio", { name: "Abusive or harassing" }));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => expect(screen.getByText("Reported. An operator will take a look. Thank you.")).toBeInTheDocument());
    expect(fixture.calls).toEqual(["POST /api/leagues/l1/chat/42/report"]);
  });

  it("shows the server's own error rather than a generic one", async () => {
    const fixture = fixtureChatDeps();
    fixture.response = { ok: false, error: "Too many reports in a short time. Give it a minute and try again." };
    renderInChat(<ReportDialog open leagueId="l1" messageId="42" onClose={() => {}} />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Too many reports in a short time. Give it a minute and try again."),
    );
  });

  it("closes via Cancel without ever sending a request", () => {
    const fixture = fixtureChatDeps();
    let closed = false;
    renderInChat(<ReportDialog open leagueId="l1" messageId="42" onClose={() => (closed = true)} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(closed).toBe(true);
    expect(fixture.calls).toHaveLength(0);
  });
});
