import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { fetchWithSessionWatch } from "./session-watch";
import { SessionNotice } from "./session-notice";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/leagues/l1" }));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("SessionNotice", () => {
  it("renders nothing until a session is lost", () => {
    const { container } = render(<SessionNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the quiet strip, with a SignInLink carrying the current path, when a background READ loses its session", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(401, { ok: false, error: "Not authenticated." }));
    render(<SessionNotice />);

    await fetchWithSessionWatch("/api/notices");

    const strip = await screen.findByRole("status");
    expect(strip).toHaveTextContent("You are signed out.");
    expect(screen.getByRole("link", { name: "Sign in to pick up where you left off" })).toHaveAttribute(
      "href",
      "/sign-in?returnTo=%2Fapp%2Fleagues%2Fl1",
    );
    fetchSpy.mockRestore();
  });

  it("escalates to a Modal, naming that nothing was sent, when a user-initiated WRITE loses its session", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(401, { ok: false, error: "Not authenticated." }));
    render(<SessionNotice />);

    await fetchWithSessionWatch("/api/invites/ABC/accept", { method: "POST", body: "{}" });

    expect(await screen.findByRole("dialog", { name: "That did not go through" })).toBeInTheDocument();
    expect(screen.getByText("Your session ended before this reached us. Nothing you typed was sent.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to pick up where you left off" })).toHaveAttribute(
      "href",
      "/sign-in?returnTo=%2Fapp%2Fleagues%2Fl1",
    );
    fetchSpy.mockRestore();
  });

  it("closes the modal back to the quiet strip rather than hiding that the session is still gone", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(401, { ok: false, error: "Not authenticated." }));
    render(<SessionNotice />);
    await fetchWithSessionWatch("/api/invites/ABC/accept", { method: "POST", body: "{}" });
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("You are signed out.");
    fetchSpy.mockRestore();
  });

  it("says only the one true sentence about state — never that the work was saved", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(401, { ok: false, error: "Not authenticated." }));
    render(<SessionNotice />);
    await fetchWithSessionWatch("/api/invites/ABC/accept", { method: "POST", body: "{}" });
    await screen.findByRole("dialog");

    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/lost/i)).not.toBeInTheDocument();
    fetchSpy.mockRestore();
  });
});
