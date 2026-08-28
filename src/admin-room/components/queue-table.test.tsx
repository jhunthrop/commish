import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { QueueRow } from "@/integrity/queue-view";
import { QueueTable } from "./queue-table";

const oldest: QueueRow = {
  flagId: "flag_old",
  icon: "alert-triangle",
  question: "A member reported a review",
  about: "A review by Ada",
  raisedAt: "2026-08-01T00:00:00.000Z",
};

const newest: QueueRow = {
  flagId: "flag_new",
  icon: "users",
  question: "The platform flagged two accounts that may be the same person",
  about: "Ada and Bob",
  raisedAt: "2026-08-02T00:00:00.000Z",
};

const mixed: readonly QueueRow[] = [oldest, newest];

/** A fixed "now" three days past the oldest flag, so the age column's own assertions are about
 *  the formatter rather than about whatever day the suite happens to run on. */
const NOW = new Date("2026-08-04T00:00:00.000Z");

/** Pins `Date.now()` for one assertion only. Deliberately NOT a `beforeEach` for the whole file:
 *  `vitest-axe` runs its own asynchronous passes on real timers, and freezing the clock around
 *  them hangs the axe suite below for its full timeout. */
async function atFixedNow(run: () => Promise<void>): Promise<void> {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    await run();
  } finally {
    vi.useRealTimers();
  }
}

describe("QueueTable — ruling 30, oldest first, no severity", () => {
  it("states how long each flag has WAITED, in the unit an operator thinks in", async () => {
    // The column used to print an absolute instant, which made an operator subtract today's date
    // from every row to learn the one thing they came for. The exact instant is still one hover
    // away, on the cell's own `title`, for anyone quoting it into a support thread.
    await atFixedNow(() => renderSurface(<QueueTable rows={mixed} />, ({ getByText, getAllByRole }) => {
      expect(getByText("Waited")).toBeInTheDocument();
      const cells = getAllByRole("cell").filter((cell) => cell.querySelector("time") !== null);
      expect(cells[0]).toHaveTextContent("3 days");
      expect(cells[1]).toHaveTextContent("2 days");
      expect(cells[0]?.querySelector("time")).toHaveAttribute("title");
      expect(cells[0]?.querySelector("time")).toHaveAttribute("dateTime", oldest.raisedAt);
    }));
  });

  it("gives the age no tint and no chip, because an age is not a severity", async () => {
    // Ruling 30 again, at the one place Gameday would most tempt an author to break it: an aging
    // queue is exactly where somebody reaches for a red pill. The order already says which is
    // oldest; a colour would be this surface ranking how serious a flag LOOKS.
    await renderSurface(<QueueTable rows={mixed} />, ({ container }) => {
      for (const time of Array.from(container.querySelectorAll("time"))) {
        expect(time.className).not.toMatch(/text-negative|text-warning|text-mag-/);
      }
    });
  });

  it("keeps oldest first, with no sort control and no severity column", async () => {
    await renderSurface(<QueueTable rows={mixed} />, ({ queryByRole, getAllByRole }) => {
      expect(queryByRole("button", { name: /sort/i })).toBeNull();
      const rows = getAllByRole("row");
      // rows[0] is the header row — the first DATA row is the oldest flag, unconditionally.
      expect(rows[1]).toHaveTextContent(oldest.question);
      expect(rows[2]).toHaveTextContent(newest.question);
    });
  });

  it("renders no severity word or ranking anywhere on the row", async () => {
    await renderSurface(<QueueTable rows={mixed} />, ({ queryByText }) => {
      for (const word of ["severity", "urgent", "priority", "high", "low"]) {
        expect(queryByText(new RegExp(word, "i"))).toBeNull();
      }
    });
  });
});

describe("QueueTable — the empty state, designed first", () => {
  it("says the queue is clear without saying nothing is happening", async () => {
    await renderSurface(<QueueTable rows={[]} />, ({ getByText }) => {
      expect(getByText("The queue is clear.")).toBeInTheDocument();
      expect(getByText("Nothing is waiting on a decision right now.")).toBeInTheDocument();
    });
  });

  it("offers a way forward from the empty state", async () => {
    await renderSurface(<QueueTable rows={[]} />, ({ getByRole }) => {
      expect(getByRole("link", { name: "Go to your leagues" })).toHaveAttribute("href", "/app");
    });
  });

  it("does not show the clear-queue empty state when a page came back empty but a cursor remains", async () => {
    await renderSurface(<QueueTable rows={[]} nextHref="/app/admin/queue?before=x" />, ({ queryByText, getByRole }) => {
      expect(queryByText("The queue is clear.")).toBeNull();
      expect(getByRole("link", { name: "Load more" })).toHaveAttribute("href", "/app/admin/queue?before=x");
    });
  });
});

describe("QueueTable — the row itself", () => {
  it("links each row to its own detail page by the row's own question text", async () => {
    await renderSurface(<QueueTable rows={mixed} />, ({ getByRole, getByText }) => {
      expect(getByRole("link", { name: oldest.question })).toHaveAttribute("href", "/app/admin/queue/flag_old");
      expect(getByRole("link", { name: newest.question })).toHaveAttribute("href", "/app/admin/queue/flag_new");
      expect(getByText(oldest.about)).toBeInTheDocument();
      expect(getByText(newest.about)).toBeInTheDocument();
    });
  });
});

describe("QueueTable — pagination stays a real navigation", () => {
  it("renders no Load more link once the queue has no further page", async () => {
    await renderSurface(<QueueTable rows={mixed} />, ({ queryByRole }) => {
      expect(queryByRole("link", { name: "Load more" })).toBeNull();
    });
  });

  it("carries the exact href it is given, unmodified", async () => {
    await renderSurface(<QueueTable rows={mixed} nextHref="/app/admin/queue?before=2026-08-02T00%3A00%3A00.000Z%7Cflag_new" />, ({ getByRole }) => {
      expect(getByRole("link", { name: "Load more" })).toHaveAttribute("href", "/app/admin/queue?before=2026-08-02T00%3A00%3A00.000Z%7Cflag_new");
    });
  });
});

describe("QueueTable — both themes, axe-clean", () => {
  it("is clean empty and populated", async () => {
    for (const element of [<QueueTable key="empty" rows={[]} />, <QueueTable key="populated" rows={mixed} nextHref="/app/admin/queue?before=x" />]) {
      await renderSurface(element, async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      });
    }
  });
});
