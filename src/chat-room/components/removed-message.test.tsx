import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { REASON_FRAGMENTS } from "@/moderation/test-support";
import { RemovedMessage } from "./removed-message";

describe("RemovedMessage", () => {
  it("keeps the author's name and avatar, and states the neutral fact, in both themes, axe-clean", async () => {
    await renderSurface(
      <RemovedMessage authorName="Jordan Lee" authorAvatarUrl={null} removal={{ at: "2026-08-20T00:00:00.000Z" }} />,
      async ({ container }) => {
        expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
        expect(screen.getByText("We removed this message.")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  /**
   * The render-level half of the reason-privacy guard. The WIRE-level half — which is where the
   * real leak was (final review, HIGH 1) — lives in `src/chat-service/chat.test.ts` and
   * `src/chat-service/moderation.test.ts`: `ChatMessageRemoval` is `{ at }` now, so this
   * component cannot be handed a reason at all and re-leaking it does not compile. This stays as
   * the defense in depth over the tombstone's own copy: whatever words it grows later, none of
   * them may be a reason from the closed vocabulary.
   */
  it("never renders any reason from the closed vocabulary, in either its phrase or its stored form", () => {
    const { container } = render(<RemovedMessage authorName="Jordan Lee" authorAvatarUrl={null} removal={{ at: "2026-08-20T00:00:00.000Z" }} />);
    for (const fragment of REASON_FRAGMENTS) {
      expect(container.textContent).not.toContain(fragment);
    }
  });
});
