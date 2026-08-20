import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { CHAT_CONFIG } from "@/chat/config";
import { inBothThemes } from "@/components/ui/test-utils";
import { TOUCHDOWN_GIF } from "../test-fixtures";
import { ChatComposer } from "./chat-composer";

const NO_GIFS = { gifSearchEnabled: false, onSearchGifs: async () => [] };

describe("ChatComposer", () => {
  it("has a visible label and a send button, in both themes, axe-clean", async () => {
    await inBothThemes(
      <ChatComposer sending={false} onSend={async () => ({ ok: true })} {...NO_GIFS} />,
      async ({ container }) => {
        expect(screen.getByLabelText("Message")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("sends the typed message and clears the field", async () => {
    const onSend = vi.fn(async () => ({ ok: true as const }));
    render(<ChatComposer sending={false} onSend={onSend} {...NO_GIFS} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "wheels up" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("wheels up"));
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue(""));
  });

  it("keeps the text and shows the reason when the send is rejected", async () => {
    render(<ChatComposer sending={false} onSend={async () => ({ ok: false, reason: "Type a message first." })} {...NO_GIFS} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "oops" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Type a message first."));
    expect(screen.getByLabelText("Message")).toHaveValue("oops");
  });

  it("refuses to send an empty message without troubling the server", () => {
    const onSend = vi.fn(async () => ({ ok: true as const }));
    render(<ChatComposer sending={false} onSend={onSend} {...NO_GIFS} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("caps the field at the server's own limit rather than inventing a second one", () => {
    render(<ChatComposer sending={false} onSend={async () => ({ ok: true })} {...NO_GIFS} />);
    expect(screen.getByLabelText("Message")).toHaveAttribute("maxLength", String(CHAT_CONFIG.maxBodyLength));
  });

  it("offers no GIF control when the seam is unconfigured — chat stays exactly what it was, not degraded", () => {
    render(<ChatComposer sending={false} onSend={async () => ({ ok: true })} {...NO_GIFS} />);
    expect(screen.queryByRole("button", { name: "Add a GIF" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled();
  });

  it("offers a GIF control when the seam is configured, in both themes, axe-clean", async () => {
    await inBothThemes(
      <ChatComposer sending={false} onSend={async () => ({ ok: true })} gifSearchEnabled onSearchGifs={async () => [TOUCHDOWN_GIF]} />,
      async ({ container }) => {
        expect(screen.getByRole("button", { name: "Add a GIF" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("sends a chosen GIF as a message and shows it with its alt text", async () => {
    const onSend = vi.fn(async () => ({ ok: true as const }));
    render(<ChatComposer sending={false} onSend={onSend} gifSearchEnabled onSearchGifs={async () => [TOUCHDOWN_GIF]} />);

    await userEvent.click(screen.getByRole("button", { name: "Add a GIF" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search GIFs" }), "touchdown");
    await userEvent.click(await screen.findByRole("button", { name: TOUCHDOWN_GIF.alt }));

    expect(onSend).toHaveBeenCalledWith(TOUCHDOWN_GIF.alt, {
      url: TOUCHDOWN_GIF.url,
      previewUrl: TOUCHDOWN_GIF.previewUrl,
      alt: TOUCHDOWN_GIF.alt,
      width: TOUCHDOWN_GIF.width,
      height: TOUCHDOWN_GIF.height,
    });
    // The picker closes once a GIF is chosen — nothing left open behind the sent message.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the send's own rejection reason when a chosen GIF is refused", async () => {
    const onSend = vi.fn(async () => ({ ok: false as const, reason: "That GIF's link isn't secure." }));
    render(<ChatComposer sending={false} onSend={onSend} gifSearchEnabled onSearchGifs={async () => [TOUCHDOWN_GIF]} />);

    await userEvent.click(screen.getByRole("button", { name: "Add a GIF" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search GIFs" }), "touchdown");
    await userEvent.click(await screen.findByRole("button", { name: TOUCHDOWN_GIF.alt }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That GIF's link isn't secure."));
  });
});
