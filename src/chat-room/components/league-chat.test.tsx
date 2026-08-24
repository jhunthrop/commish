import { describe, it, expect } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { ChatRoomDepsProvider } from "../hooks/deps";
import { CHAT_PAGE, TOUCHDOWN_GIF, chatMessage, fixtureChatDeps, renderInChat } from "../test-fixtures";
import { LeagueChat } from "./league-chat";

describe("LeagueChat", () => {
  it("shows the loaded conversation, in both themes, axe-clean", async () => {
    const fixture = fixtureChatDeps();
    await renderSurface(
      <ChatRoomDepsProvider deps={fixture.deps}>
        <LeagueChat leagueId="l1" />
      </ChatRoomDepsProvider>,
      async ({ container }) => {
        await waitFor(() => expect(screen.getByText("wheels up")).toBeInTheDocument());
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("shows a loading state before the first page lands", () => {
    const fixture = fixtureChatDeps();
    fixture.deps = { ...fixture.deps, fetchJson: () => new Promise(() => {}) };
    renderChat(fixture);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("offers a retry when the chat can't be loaded", async () => {
    const fixture = fixtureChatDeps();
    fixture.response = { ok: false, error: "You do not have a team in this league." };
    renderChat(fixture);
    await waitFor(() => expect(screen.getByText("You do not have a team in this league.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("folds a live message from somebody else straight into the list", async () => {
    const fixture = fixtureChatDeps();
    renderChat(fixture);
    await waitFor(() => expect(screen.getByText("wheels up")).toBeInTheDocument());
    act(() => fixture.emit("chat.message", { message: chatMessage("3", { body: "big board" }) }));
    await waitFor(() => expect(screen.getByText("big board")).toBeInTheDocument());
  });

  it("says so while the stream is reconnecting, without hiding the conversation", async () => {
    const fixture = fixtureChatDeps();
    renderChat(fixture);
    await waitFor(() => expect(screen.getByText("wheels up")).toBeInTheDocument());
    act(() => fixture.fire("error"));
    await waitFor(() => expect(screen.getByText("Reconnecting…")).toBeInTheDocument());
    expect(screen.getByText("wheels up")).toBeInTheDocument();
  });

  it("offers no GIF control when the seam is unconfigured", async () => {
    const fixture = fixtureChatDeps({ ...CHAT_PAGE, gifSearchEnabled: false });
    renderChat(fixture);
    await waitFor(() => expect(screen.getByText("wheels up")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Add a GIF" })).not.toBeInTheDocument();
  });

  it("searches, sends and shows a chosen GIF end to end — compose, log and its alt text agree", async () => {
    const fixture = fixtureChatDeps({ ...CHAT_PAGE, gifSearchEnabled: true });
    renderChat(fixture);
    await waitFor(() => expect(screen.getByText("wheels up")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Add a GIF" }));
    fixture.response = { ok: true, data: { results: [TOUCHDOWN_GIF] } };
    await userEvent.type(screen.getByRole("searchbox", { name: "Search GIFs" }), "touchdown");
    await screen.findByRole("button", { name: TOUCHDOWN_GIF.alt });

    fixture.response = {
      ok: true,
      data: { message: chatMessage("3", { authorUserId: "u1", body: TOUCHDOWN_GIF.alt, gif: TOUCHDOWN_GIF }) },
    };
    await userEvent.click(screen.getByRole("button", { name: TOUCHDOWN_GIF.alt }));

    expect(await screen.findByRole("img", { name: TOUCHDOWN_GIF.alt })).toBeInTheDocument();
  });
});

function renderChat(fixture: ReturnType<typeof fixtureChatDeps>) {
  return renderInChat(<LeagueChat leagueId="l1" />, fixture.deps);
}
