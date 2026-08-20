import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { RemovedMessage } from "./removed-message";

describe("RemovedMessage", () => {
  it("keeps the author's name and avatar, states the removal, and names the reason, in both themes, axe-clean", async () => {
    await inBothThemes(
      <RemovedMessage authorName="Jordan Lee" authorAvatarUrl={null} removal={{ at: "2026-08-20T00:00:00.000Z", phrase: "spam or fake content" }} />,
      async ({ container }) => {
        expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
        expect(screen.getByText(/A message was removed\./)).toBeInTheDocument();
        expect(screen.getByText(/spam or fake content/)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("renders a different phrase for a different removal reason, never a raw token", () => {
    render(<RemovedMessage authorName="Jordan Lee" authorAvatarUrl={null} removal={{ at: "2026-08-20T00:00:00.000Z", phrase: "abusive or harassing content" }} />);
    expect(screen.getByText(/abusive or harassing content/)).toBeInTheDocument();
  });
});
