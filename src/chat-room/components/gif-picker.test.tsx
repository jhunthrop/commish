import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { CHAT_ROOM_CONFIG } from "../config";
import { TOUCHDOWN_GIF } from "../test-fixtures";
import { GifPicker } from "./gif-picker";

afterEach(() => {
  vi.useRealTimers();
});

describe("GifPicker", () => {
  it("renders nothing when closed", () => {
    render(<GifPicker open={false} onClose={() => {}} search={async () => []} onPick={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("has a labeled search box and no results before anything is typed, in both themes, axe-clean", async () => {
    await renderSurface(
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

  it("collapses a burst of keystrokes into one search, fired after the debounce pause", () => {
    vi.useFakeTimers();
    const search = vi.fn(async () => [TOUCHDOWN_GIF]);
    render(<GifPicker open onClose={() => {}} search={search} onPick={() => {}} />);
    const box = screen.getByRole("searchbox", { name: "Search GIFs" });

    fireEvent.change(box, { target: { value: "t" } });
    fireEvent.change(box, { target: { value: "to" } });
    fireEvent.change(box, { target: { value: "tou" } });
    expect(search).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(CHAT_ROOM_CONFIG.gifSearchDebounceMs);
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("tou");
  });

  // The exact race class use-league-chat's refreshGeneration guard exists for: two different
  // debounced searches both end up in flight (typed, paused long enough to fire, typed again
  // before that response landed), and the OLDER one's response arrives SECOND. Without a
  // generation guard, that stale response would land last and silently clobber the fresher one.
  it("keeps the newest search's results when an older one resolves after it", async () => {
    vi.useFakeTimers();
    const OLDER = { ...TOUCHDOWN_GIF, id: "older", alt: "An older search's GIF" };
    const NEWER = { ...TOUCHDOWN_GIF, id: "newer", alt: "A newer search's GIF" };
    const pending = new Map<string, (results: readonly (typeof OLDER)[]) => void>();
    const search = vi.fn(
      (query: string) =>
        new Promise<readonly (typeof OLDER)[]>((resolve) => {
          pending.set(query, resolve);
        }),
    );
    render(<GifPicker open onClose={() => {}} search={search} onPick={() => {}} />);
    const box = screen.getByRole("searchbox", { name: "Search GIFs" });

    fireEvent.change(box, { target: { value: "older" } });
    act(() => {
      vi.advanceTimersByTime(CHAT_ROOM_CONFIG.gifSearchDebounceMs);
    });
    expect(search).toHaveBeenCalledWith("older");

    fireEvent.change(box, { target: { value: "newer" } });
    act(() => {
      vi.advanceTimersByTime(CHAT_ROOM_CONFIG.gifSearchDebounceMs);
    });
    expect(search).toHaveBeenCalledWith("newer");

    // Resolution order is the INVERSE of request order — the newer search answers first, the
    // older one answers after it. A plain "last write wins" would let the older response undo
    // the newer one's results; the generation guard must refuse to apply it.
    await act(async () => {
      pending.get("newer")!([NEWER]);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      pending.get("older")!([OLDER]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: NEWER.alt })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: OLDER.alt })).not.toBeInTheDocument();
  });

  it("invalidates an in-flight search when the box is emptied before it resolves", async () => {
    vi.useFakeTimers();
    let resolveSearch: ((results: readonly (typeof TOUCHDOWN_GIF)[]) => void) | undefined;
    const search = vi.fn(() => new Promise<readonly (typeof TOUCHDOWN_GIF)[]>((resolve) => (resolveSearch = resolve)));
    render(<GifPicker open onClose={() => {}} search={search} onPick={() => {}} />);
    const box = screen.getByRole("searchbox", { name: "Search GIFs" });

    fireEvent.change(box, { target: { value: "touchdown" } });
    act(() => {
      vi.advanceTimersByTime(CHAT_ROOM_CONFIG.gifSearchDebounceMs);
    });
    expect(search).toHaveBeenCalledWith("touchdown");

    fireEvent.change(box, { target: { value: "" } });
    await act(async () => {
      resolveSearch!([TOUCHDOWN_GIF]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole("button", { name: TOUCHDOWN_GIF.alt })).not.toBeInTheDocument();
  });
});
