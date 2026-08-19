import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { CHAT_CONFIG } from "@/chat/config";
import { inBothThemes } from "@/components/ui/test-utils";
import { ChatComposer } from "./chat-composer";

describe("ChatComposer", () => {
  it("has a visible label and a send button, in both themes, axe-clean", async () => {
    await inBothThemes(<ChatComposer sending={false} onSend={async () => ({ ok: true })} />, async ({ container }) => {
      expect(screen.getByLabelText("Message")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("sends the typed message and clears the field", async () => {
    const onSend = vi.fn(async () => ({ ok: true as const }));
    render(<ChatComposer sending={false} onSend={onSend} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "wheels up" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("wheels up"));
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue(""));
  });

  it("keeps the text and shows the reason when the send is rejected", async () => {
    render(<ChatComposer sending={false} onSend={async () => ({ ok: false, reason: "Type a message first." })} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "oops" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Type a message first."));
    expect(screen.getByLabelText("Message")).toHaveValue("oops");
  });

  it("refuses to send an empty message without troubling the server", () => {
    const onSend = vi.fn(async () => ({ ok: true as const }));
    render(<ChatComposer sending={false} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("caps the field at the server's own limit rather than inventing a second one", () => {
    render(<ChatComposer sending={false} onSend={async () => ({ ok: true })} />);
    expect(screen.getByLabelText("Message")).toHaveAttribute("maxLength", String(CHAT_CONFIG.maxBodyLength));
  });
});
