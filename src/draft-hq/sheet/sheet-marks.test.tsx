import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MySheetClient } from "./my-sheet-client";
import type { SheetColumnsPayload } from "./columns-payload";
import type { SheetEntryView } from "./view";

/**
 * THE MANAGER'S OWN MARKS, END TO END FROM THE ROW (fix round 1, H2).
 *
 * Retiring the sheet's table took the note, the tag, the tier label and per-row remove with it,
 * and nothing in the product edited them any more — a player added by mistake could only be got
 * rid of by re-seeding, which replaces every row. They live on the row itself now, in the same
 * hover-and-focus cluster the reorder arrows already sit in, and this pins that each one reaches
 * the API call it always had.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const CHASE = "p-chase";
const NACUA = "p-nacua";

function entry(playerId: string, name: string, rank: number, overrides: Partial<SheetEntryView> = {}): SheetEntryView {
  return { id: `e-${playerId}`, playerId, rank, tierLabel: null, note: null, tag: null, name, position: "WR", team: "CIN", byeWeek: 6, boardRank: rank, ...overrides };
}

const ENTRIES: readonly SheetEntryView[] = [entry(NACUA, "Puka Nacua", 1), entry(CHASE, "Ja'Marr Chase", 2, { note: "Bounce back", tag: "target" })];

const COLUMNS: SheetColumnsPayload = {
  order: [NACUA, CHASE],
  boardIds: [NACUA, CHASE],
  players: [
    { id: NACUA, name: "Puka Nacua", position: "WR", nflTeam: "LAR", headshotUrl: null, adp: 3.3 },
    { id: CHASE, name: "Ja'Marr Chase", position: "WR", nflTeam: "CIN", headshotUrl: null, adp: 1.4 },
  ],
  values: [
    [NACUA, 162.8],
    [CHASE, 147.9],
  ],
  tiers: {},
  overallTiers: {},
  targets: [CHASE],
  marks: [[CHASE, { note: "Bounce back", tag: "target", tierLabel: null }]],
};

function mount() {
  return render(
    <MySheetClient
      sheets={[{ id: "s1", userId: "u1", leagueId: null, name: "My sheet", createdAt: "", updatedAt: "", entryCount: 2 }]}
      selectedSheetId="s1"
      selectedSheetName="My sheet"
      entries={ENTRIES}
      boardOptions={[]}
      columns={COLUMNS}
      basis="Generic board: 12 teams, a standard roster shape. PPR, 2026 projections."
      headerQuery={{}}
      scheduled={null}
      insights={{ mockHistory: { firstTeRounds: null, mockCount: 0, mostDrafted: [] } as never, byeStack: null, sheetHealth: null }}
    />,
  );
}

/** The row's controls only exist while a pointer is over it or the keyboard is inside it, so the
 *  test opens the marks panel the way a reader does. */
function openMarks(name: string): HTMLElement {
  const row = screen.getAllByTestId("sheet-row").find((node) => within(node).queryByText(name) !== null);
  if (row === undefined) throw new Error(`no row for ${name}`);
  fireEvent.click(within(row).getByRole("button", { name: `Notes and tags for ${name}` }));
  return within(row).getByTestId("sheet-row-marks");
}

describe("the sheet row's own marks", () => {
  let calls: { readonly url: string; readonly method: string; readonly body: string | null }[];

  beforeEach(() => {
    calls = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("writes a note from the row it is about", async () => {
    mount();
    const panel = openMarks("Puka Nacua");
    const note = within(panel).getByLabelText("Note on Puka Nacua");
    fireEvent.change(note, { target: { value: "Target at 1.03" } });
    fireEvent.blur(note);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: "/api/draft/sheets/s1/entries", method: "POST" });
    expect(JSON.parse(calls[0]!.body!)).toEqual({ playerId: NACUA, note: "Target at 1.03" });
  });

  it("sets a tag from the row, and takes the same tag off when it is already on", async () => {
    mount();
    fireEvent.click(within(openMarks("Puka Nacua")).getByRole("button", { name: "Target" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(calls[0]!.body!)).toEqual({ playerId: NACUA, tag: "target" });

    // Chase already carries it, so the same press is how it comes off.
    fireEvent.click(within(openMarks("Ja'Marr Chase")).getByRole("button", { name: "Target" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(JSON.parse(calls[1]!.body!)).toEqual({ playerId: CHASE, tag: null });
  });

  it("takes a man off the sheet from his own row", async () => {
    mount();
    fireEvent.click(within(openMarks("Puka Nacua")).getByRole("button", { name: "Take him off" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: `/api/draft/sheets/s1/entries?playerId=${NACUA}`, method: "DELETE" });
  });

  it("writes the manager's own tier label", async () => {
    mount();
    const panel = openMarks("Puka Nacua");
    const tier = within(panel).getByLabelText("Your tier for Puka Nacua");
    fireEvent.change(tier, { target: { value: "Round 1" } });
    fireEvent.blur(tier);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(calls[0]!.body!)).toEqual({ playerId: NACUA, tierLabel: "Round 1" });
  });

  it("shows a note and a tag on the row itself, without anybody hovering it", () => {
    mount();
    const row = screen.getAllByTestId("sheet-row").find((node) => within(node).queryByText("Ja'Marr Chase") !== null)!;
    expect(row.textContent).toContain("Bounce back");
    expect(within(row).getByTestId("sheet-row-tag")).toHaveTextContent("Target");
  });
});
