import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FactsAsOf } from "./facts-as-of";

const HERE = dirname(new URL(import.meta.url).pathname);

describe("FactsAsOf", () => {
  /**
   * THE DIRECTIVE IS THE WHOLE CORRECTNESS ARGUMENT, so it is asserted rather than trusted. The peek
   * already runs on the client; the full player page is a React Server Component, and without this
   * line `Intl` with an undefined locale would resolve against the SERVER's zone there and the
   * viewer's here, printing two different times for one document.
   */
  it("is a client component, so both surfaces format the stamp on the viewer's own machine", () => {
    expect(readFileSync(join(HERE, "facts-as-of.tsx"), "utf8").startsWith('"use client";')).toBe(true);
  });

  it("is reached by both surfaces through the one shared composition", () => {
    const composition = readFileSync(join(HERE, "dossier-composition.tsx"), "utf8");
    expect(composition).toContain("<FactsAsOf");
    const peek = readFileSync(join(HERE, "..", "components", "player-peek.tsx"), "utf8");
    const page = readFileSync(join(HERE, "..", "..", "app", "app", "(shell)", "leagues", "[leagueId]", "players", "[playerId]", "page.tsx"), "utf8");
    expect(peek).toContain("<DossierComposition");
    expect(page).toContain("<DossierComposition");
  });

  it("names the moment the document's facts were knowable", () => {
    render(<FactsAsOf asOf="2026-09-07T12:00:00.000Z" />);
    expect(screen.getByText(/Facts as of/)).toHaveTextContent(new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date("2026-09-07T12:00:00.000Z")));
  });

  it("says plainly that the roster status beside it is not part of that stamp", () => {
    render(<FactsAsOf asOf="2026-09-07T12:00:00.000Z" />);
    expect(screen.getByText(/Roster status is live/)).toBeInTheDocument();
  });

  it("renders nothing at all for a body carrying no stamp, rather than inventing now", () => {
    const { container } = render(<FactsAsOf />);
    expect(container).toBeEmptyDOMElement();
  });
});
