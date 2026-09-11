import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { THREE_TEAMS } from "../test-fixtures";
import { WhoIsHere } from "./who-is-here";

describe("WhoIsHere", () => {
  it("names the others in the room by first name, faces first, in both themes, axe-clean", async () => {
    await renderSurface(<WhoIsHere teams={THREE_TEAMS} present={new Set(["u1", "u2", "u3"])} meUserId="u1" />, async ({ container }) => {
      expect(screen.getByText("Jordan and Sam are here.")).toBeInTheDocument();
      expect(screen.getByText("JL")).toBeInTheDocument();
      expect(screen.getByText("SP")).toBeInTheDocument();
      expect(screen.queryByText("AR")).toBeNull();
      expect(screen.getByTestId("presence-dot")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("says just you when your own connection is the only one", () => {
    render(<WhoIsHere teams={THREE_TEAMS} present={new Set(["u1"])} meUserId="u1" />);
    expect(screen.getByText("Just you right now.")).toBeInTheDocument();
  });

  it("says nothing at all until the presence store has confirmed a connection, never an empty room", () => {
    const { container } = render(<WhoIsHere teams={THREE_TEAMS} present={new Set()} meUserId="u1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("handles one and three names in plain words", () => {
    const one = render(<WhoIsHere teams={THREE_TEAMS} present={new Set(["u2"])} meUserId="u1" />);
    expect(one.getByText("Jordan is here.")).toBeInTheDocument();
    one.unmount();
    const commissionerWithoutTeam = render(<WhoIsHere teams={THREE_TEAMS} present={new Set(["u1", "u2", "u3"])} meUserId={null} />);
    expect(commissionerWithoutTeam.getByText("Alex, Jordan and Sam are here.")).toBeInTheDocument();
  });
});
