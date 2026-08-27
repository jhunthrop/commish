import { describe, expect, it } from "vitest";
import { pageTitle, TITLE_TEMPLATE } from "./page-metadata";

describe("pageTitle", () => {
  it("returns a metadata object carrying only the page's own short title", () => {
    expect(pageTitle("Your leagues")).toEqual({ title: "Your leagues" });
  });

  it("never types the ' · Commish' suffix itself — that is the template's job alone", () => {
    expect(pageTitle("Wallet")).not.toEqual({ title: "Wallet · Commish" });
  });

  it("carries the one rule every page title obeys, composed with %s", () => {
    expect(TITLE_TEMPLATE).toBe("%s · Commish");
    expect(TITLE_TEMPLATE.replace("%s", "Your leagues")).toBe("Your leagues · Commish");
  });
});
