import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import type { Player } from "@/domain/player";
import { renderSurface } from "./test-utils";
import { PlayerObject, splitName } from "./player-object";

const CHASE: Player = { id: "p1", name: "Ja'Marr Chase", position: "WR", nflTeam: "CIN", headshotUrl: null, adp: 1.6 };

describe("splitName", () => {
  it("takes the FIRST word as the given name, so a two-word surname survives", () => {
    // The obvious split — last word is the surname — is wrong on a real roster, and both of
    // these are men who play in this league's own dataset.
    expect(splitName("Amon-Ra St. Brown")).toEqual({ given: "Amon-Ra", family: "St. Brown" });
    expect(splitName("Marvin Harrison Jr.")).toEqual({ given: "Marvin", family: "Harrison Jr." });
    expect(splitName("Ja'Marr Chase")).toEqual({ given: "Ja'Marr", family: "Chase" });
  });

  it("gives a single-token name no first line at all rather than an empty one", () => {
    expect(splitName("Chase")).toEqual({ given: null, family: "Chase" });
  });
});

describe("PlayerObject", () => {
  it("is the page's own heading, so the name is never printed twice at two sizes", async () => {
    await renderSurface(<PlayerObject player={CHASE} />, ({ getByRole }) => {
      expect(getByRole("heading", { level: 1 })).toHaveTextContent("Ja'Marr Chase");
    });
  });

  it("carries the facts as chips and not as a sentence", async () => {
    await renderSurface(<PlayerObject player={CHASE} />, ({ getByText, container }) => {
      expect(getByText("WR")).toBeInTheDocument();
      expect(getByText("CIN")).toBeInTheDocument();
      // The club colour belongs behind the face and nowhere else — rule 1's team-identity
      // amendment. No text on this component may be painted in it.
      expect(container.querySelector("[data-testid='player-face-team']")).toHaveAttribute("data-team", "CIN");
      expect(container.querySelector("h1")?.getAttribute("style")).toBeNull();
    });
  });

  it("draws no club tile for a player with no club, rather than a grey rectangle pretending to be one", async () => {
    const freeAgent: Player = { ...CHASE, nflTeam: "" };
    await renderSurface(<PlayerObject player={freeAgent} />, ({ container, queryByText }) => {
      expect(container.querySelector("[data-testid='player-face-team']")).toBeNull();
      expect(queryByText("CIN")).not.toBeInTheDocument();
    });
  });

  it("has no axe violations in either theme", async () => {
    await renderSurface(<PlayerObject player={CHASE} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
