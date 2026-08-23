import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { Panel } from "./panel";

describe("Panel", () => {
  it("renders the title as an h2 by default, with its content, in both themes, axe-clean", async () => {
    await renderSurface(
      <Panel title="Standings">
        <p>Body content</p>
      </Panel>,
      async ({ getByRole, getByText, container }) => {
        expect(getByRole("heading", { level: 2, name: "Standings" })).toBeInTheDocument();
        expect(getByText("Body content")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("renders an h3 when headingLevel is 3", () => {
    renderSurface(
      <Panel title="Managers" headingLevel={3}>
        <p>Roster</p>
      </Panel>,
      ({ getByRole }) => {
        expect(getByRole("heading", { level: 3, name: "Managers" })).toBeInTheDocument();
      },
    );
  });

  it("shows the meta note beside the title when given", () => {
    renderSurface(
      <Panel title="Open leagues" meta="Closest first">
        <p>List</p>
      </Panel>,
      ({ getByText }) => {
        expect(getByText("Closest first")).toBeInTheDocument();
      },
    );
  });

  it("renders no meta note when none is given", () => {
    renderSurface(
      <Panel title="Open leagues">
        <p>List</p>
      </Panel>,
      ({ queryByText }) => {
        expect(queryByText("Closest first")).not.toBeInTheDocument();
      },
    );
  });
});
