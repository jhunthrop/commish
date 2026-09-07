import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FactsAsOf } from "./facts-as-of";

describe("FactsAsOf", () => {
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
