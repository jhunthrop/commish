import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import { REDUCED_MOTION_QUERY } from "@/design/use-reduced-motion";
import { UI_CONFIG } from "./config";
import { ToastProvider, useToast } from "./toast";
import { Button } from "./button";
import { inBothThemes } from "./test-utils";

function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function Publisher() {
  const { show } = useToast();
  return (
    <div>
      <Button onClick={() => show({ message: "Someone else picked first. Try again.", tone: "error" })}>Fail</Button>
      <Button onClick={() => show({ message: "Pick submitted.", tone: "success" })}>Succeed</Button>
      <Button onClick={() => show({ message: "Draft paused.", action: { label: "Resume", onClick: () => show({ message: "Resumed." }) } })}>
        Actionable
      </Button>
    </div>
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ToastProvider", () => {
  it("announces an error toast as an alert and is axe-clean in both themes", async () => {
    stubMatchMedia(false);
    await inBothThemes(
      <ToastProvider>
        <Publisher />
      </ToastProvider>,
      async ({ container }) => {
        fireEvent.click(screen.getByRole("button", { name: "Fail" }));
        expect(screen.getByRole("alert")).toHaveTextContent("Someone else picked first. Try again.");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("puts non-error toasts in the polite live region rather than an alert", () => {
    stubMatchMedia(false);
    render(
      <ToastProvider>
        <Publisher />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Succeed" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Pick submitted.")).toBeInTheDocument();
    expect(screen.getByTestId("toast-region")).toHaveAttribute("aria-live", "polite");
  });

  it("auto-dismisses after the configured delay", () => {
    stubMatchMedia(false);
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Publisher />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Succeed" }));
    act(() => void vi.advanceTimersByTime(UI_CONFIG.toast.dismissMs - 1));
    expect(screen.getByText("Pick submitted.")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.queryByText("Pick submitted.")).toBeNull();
  });

  it("gives reduced-motion users the longer dwell time", () => {
    stubMatchMedia(true);
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Publisher />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Succeed" }));
    act(() => void vi.advanceTimersByTime(UI_CONFIG.toast.dismissMs));
    expect(screen.getByText("Pick submitted.")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(UI_CONFIG.toast.reducedMotionDismissMs - UI_CONFIG.toast.dismissMs));
    expect(screen.queryByText("Pick submitted.")).toBeNull();
  });

  it("runs a toast action and lets the toast be dismissed by hand", () => {
    stubMatchMedia(false);
    render(
      <ToastProvider>
        <Publisher />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Actionable" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(screen.getByText("Resumed.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
    expect(screen.queryByText("Draft paused.")).toBeNull();
  });

  it("keeps at most the configured number of toasts on screen", () => {
    stubMatchMedia(false);
    render(
      <ToastProvider>
        <Publisher />
      </ToastProvider>,
    );
    for (let i = 0; i < UI_CONFIG.toast.maxVisible + 2; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Succeed" }));
    }
    expect(screen.getAllByText("Pick submitted.")).toHaveLength(UI_CONFIG.toast.maxVisible);
  });

  it("throws a clear error when useToast is called outside the provider", () => {
    function Orphan() {
      useToast();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow("useToast must be used inside <ToastProvider>.");
  });
});
