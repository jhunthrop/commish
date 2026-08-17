import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { REDUCED_MOTION_QUERY, usePrefersReducedMotion } from "./use-reduced-motion";

type Listener = (event: { matches: boolean }) => void;

function stubMatchMedia(matches: boolean) {
  const listeners: Listener[] = [];
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY ? matches : false,
    media: query,
    addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
    removeEventListener: (_type: string, listener: Listener) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  }));
  return { emit: (next: boolean) => listeners.forEach((l) => l({ matches: next })) };
}

function Probe() {
  return <p>{usePrefersReducedMotion() ? "reduced" : "full"}</p>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePrefersReducedMotion", () => {
  it("reports full motion when the query does not match", () => {
    stubMatchMedia(false);
    render(<Probe />);
    expect(screen.getByText("full")).toBeInTheDocument();
  });

  it("reports reduced motion when the query matches", () => {
    stubMatchMedia(true);
    render(<Probe />);
    expect(screen.getByText("reduced")).toBeInTheDocument();
  });

  it("follows the preference changing while mounted", () => {
    const media = stubMatchMedia(false);
    render(<Probe />);
    act(() => media.emit(true));
    expect(screen.getByText("reduced")).toBeInTheDocument();
  });
});
