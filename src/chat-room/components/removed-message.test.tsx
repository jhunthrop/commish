import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { RemovedMessage } from "./removed-message";

describe("RemovedMessage", () => {
  it("keeps the author's name and avatar, and states the neutral fact, in both themes, axe-clean", async () => {
    await inBothThemes(
      <RemovedMessage authorName="Jordan Lee" authorAvatarUrl={null} removal={{ at: "2026-08-20T00:00:00.000Z", phrase: "spam or fake content" }} />,
      async ({ container }) => {
        expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
        expect(screen.getByText("A message was removed.")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  /**
   * Fix round 1 (review adjudication, HIGH): the room sees ONLY the neutral fact. The reason
   * reaches the author alone, through the notice's own private `quoteFor` blockquote — reviews'
   * own precedent, mirrored exactly. Inverted assertion, the same shape the notice-privacy
   * guards elsewhere in this codebase use: prove the phrase is ABSENT, for every reason in the
   * closed vocabulary, not just that some other text is present.
   */
  it("never renders the removal reason to the room, for any reason in the closed vocabulary", () => {
    const reasons = ["spam or fake content", "abusive or harassing content", "breaking the chat rules"];
    for (const phrase of reasons) {
      const { unmount } = render(<RemovedMessage authorName="Jordan Lee" authorAvatarUrl={null} removal={{ at: "2026-08-20T00:00:00.000Z", phrase }} />);
      expect(screen.queryByText(new RegExp(phrase))).not.toBeInTheDocument();
      unmount();
    }
  });
});
