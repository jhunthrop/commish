import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { TOUCHDOWN_GIF } from "../test-fixtures";
import { GifPicker } from "./gif-picker";

describe("GifPicker", () => {
  it("renders nothing when closed", () => {
    render(<GifPicker open={false} onClose={() => {}} search={async () => []} onPick={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("has a labeled search box and no results before anything is typed, in both themes, axe-clean", async () => {
    await inBothThemes(
      <GifPicker open onClose={() => {}} search={async () => [TOUCHDOWN_GIF]} onPick={() => {}} />,
      async ({ container }) => {
        expect(screen.getByRole("searchbox", { name: "Search GIFs" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: TOUCHDOWN_GIF.alt })).not.toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("searches as the user types and shows every result named by its own alt text", async () => {
    const search = vi.fn(async (query: string) => (query === "" ? [] : [TOUCHDOWN_GIF]));
    render(<GifPicker open onClose={() => {}} search={search} onPick={() => {}} />);

    await userEvent.type(screen.getByRole("searchbox", { name: "Search GIFs" }), "touchdown");

    await waitFor(() => expect(search).toHaveBeenCalledWith("touchdown"));
    expect(await screen.findByRole("button", { name: TOUCHDOWN_GIF.alt })).toBeInTheDocument();
  });

  it("picks a GIF and reports it to the caller", async () => {
    const onPick = vi.fn();
    render(<GifPicker open onClose={() => {}} search={async () => [TOUCHDOWN_GIF]} onPick={onPick} />);

    await userEvent.type(screen.getByRole("searchbox", { name: "Search GIFs" }), "touchdown");
    await userEvent.click(await screen.findByRole("button", { name: TOUCHDOWN_GIF.alt }));

    expect(onPick).toHaveBeenCalledWith(TOUCHDOWN_GIF);
  });

  it("shows a plain-language error when the search fails, rather than a silent empty grid", async () => {
    render(<GifPicker open onClose={() => {}} search={async () => Promise.reject(new Error("offline"))} onPick={() => {}} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search GIFs" }), "touchdown");
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't search GIFs. Check your connection and try again.");
  });

  it("says so when a search comes back with nothing", async () => {
    render(<GifPicker open onClose={() => {}} search={async () => []} onPick={() => {}} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search GIFs" }), "xyzzy");
    expect(await screen.findByText("No GIFs found. Try another search.")).toBeInTheDocument();
  });

  it("clears results when the search box is emptied again", async () => {
    render(<GifPicker open onClose={() => {}} search={async () => [TOUCHDOWN_GIF]} onPick={() => {}} />);
    const box = screen.getByRole("searchbox", { name: "Search GIFs" });
    await userEvent.type(box, "touchdown");
    expect(await screen.findByRole("button", { name: TOUCHDOWN_GIF.alt })).toBeInTheDocument();
    await userEvent.clear(box);
    await waitFor(() => expect(screen.queryByRole("button", { name: TOUCHDOWN_GIF.alt })).not.toBeInTheDocument());
  });

  it("closes on request", async () => {
    const onClose = vi.fn();
    render(<GifPicker open onClose={onClose} search={async () => []} onPick={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
