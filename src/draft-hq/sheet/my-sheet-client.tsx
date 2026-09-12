"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Modal, SegmentGroup } from "@/components/ui";
import { DraftHeader } from "@/draft-hq/draft-header";
import { ScheduledLine, type ScheduledDraft } from "@/draft-hq/scheduled-line";
import type { SheetSummary } from "./types";
import type { BoardOption, SheetEntryView } from "./view";
import type { ByeStackWarning, MockHistoryInsights, MostDraftedPlayerView } from "./insights";
import type { SheetHealthReport } from "./health";
import type { SheetColumnsPayload } from "./columns-payload";
import { SheetColumnsView } from "./sheet-columns-view";
import { InsightsRail } from "./insights-rail";
import { parseSheetCsv, sheetToCsv } from "./csv";

export interface MySheetClientProps {
  readonly sheets: readonly SheetSummary[];
  readonly selectedSheetId: string | null;
  readonly selectedSheetName: string | null;
  readonly entries: readonly SheetEntryView[];
  readonly boardOptions: readonly BoardOption[];
  /** The seven columns' own facts, assembled server-side (`columns-payload.ts`). */
  readonly columns: SheetColumnsPayload;
  /** "2026 board, 12-team PPR" — what every number on a row is under. */
  readonly basis: string;
  readonly scheduled: ScheduledDraft | null;
  readonly insights: {
    readonly mockHistory: Omit<MockHistoryInsights, "mostDrafted"> & { readonly mostDrafted: readonly MostDraftedPlayerView[] };
    readonly byeStack: ByeStackWarning | null;
    readonly sheetHealth: SheetHealthReport | null;
  };
}

type ModalKind = "create" | "rename" | "duplicate" | null;

async function api(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
}

/**
 * MY SHEET'S CLIENT HALF (spec §4) — the sheet picker (create/duplicate/rename/delete), the
 * table, seeding, CSV import/export, print, and the add-player search. Every mutation posts
 * through `/api/draft/sheets/**` and then calls `router.refresh()`: this component holds no
 * separate client cache, so what it shows can never drift from what the room's SHEET tab reads
 * off the same store.
 */
export function MySheetClient({ sheets, selectedSheetId, selectedSheetName, entries, boardOptions, columns, basis, scheduled, insights }: MySheetClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [modal, setModal] = useState<ModalKind>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [search, setSearch] = useState("");
  const [unresolved, setUnresolved] = useState<{ readonly unresolvedNames: readonly string[]; readonly duplicateNames: readonly string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function refresh(): void {
    startTransition(() => router.refresh());
  }

  function goTo(sheetId: string): void {
    router.push(`/app/draft/sheet?sheet=${encodeURIComponent(sheetId)}`);
  }

  async function createSheet(name: string): Promise<void> {
    const response = await api("/api/draft/sheets", { method: "POST", body: JSON.stringify({ name }) });
    const body = (await response.json()) as { readonly ok: boolean; readonly data?: { readonly id: string } };
    if (body.ok && body.data) goTo(body.data.id);
    setModal(null);
  }

  async function renameSheet(name: string): Promise<void> {
    if (selectedSheetId === null) return;
    await api(`/api/draft/sheets/${selectedSheetId}`, { method: "PATCH", body: JSON.stringify({ name }) });
    setModal(null);
    refresh();
  }

  async function duplicateSheet(name: string): Promise<void> {
    if (selectedSheetId === null) return;
    const response = await api(`/api/draft/sheets/${selectedSheetId}/duplicate`, { method: "POST", body: JSON.stringify({ name }) });
    const body = (await response.json()) as { readonly ok: boolean; readonly data?: { readonly id: string } };
    if (body.ok && body.data) goTo(body.data.id);
    setModal(null);
  }

  async function deleteSheet(): Promise<void> {
    if (selectedSheetId === null) return;
    if (!window.confirm(`Delete "${selectedSheetName}"? This cannot be undone.`)) return;
    await api(`/api/draft/sheets/${selectedSheetId}`, { method: "DELETE" });
    const remaining = sheets.filter((sheet) => sheet.id !== selectedSheetId);
    router.push(remaining.length > 0 ? `/app/draft/sheet?sheet=${remaining[0]!.id}` : "/app/draft/sheet");
  }

  async function seed(source: "board" | "mocks"): Promise<void> {
    if (selectedSheetId === null) return;
    if (entries.length > 0 && !window.confirm("This replaces every row currently on this sheet. Continue?")) return;
    const response = await api(`/api/draft/sheets/${selectedSheetId}/seed`, { method: "POST", body: JSON.stringify({ source }) });
    if (!response.ok) {
      const body = (await response.json()) as { readonly error?: string };
      window.alert(body.error ?? "Could not seed this sheet.");
      return;
    }
    refresh();
  }

  async function addPlayer(playerId: string): Promise<void> {
    if (selectedSheetId === null) return;
    await api(`/api/draft/sheets/${selectedSheetId}/entries`, { method: "POST", body: JSON.stringify({ playerId }) });
    setSearch("");
    refresh();
  }

  async function reorder(order: readonly string[]): Promise<void> {
    if (selectedSheetId === null) return;
    await api(`/api/draft/sheets/${selectedSheetId}/entries`, { method: "PUT", body: JSON.stringify({ order }) });
    refresh();
  }

  /** One player from where he is to `to`, and the whole order posted — the same PUT a drag and an
   *  arrow press both land on, so the two gestures can never write two different orders. */
  function place(playerId: string, to: number): void {
    const from = columns.order.indexOf(playerId);
    if (from === -1) return;
    const target = Math.max(0, Math.min(columns.order.length - 1, to));
    if (target === from) return;
    const without = columns.order.filter((id) => id !== playerId);
    void reorder([...without.slice(0, target), playerId, ...without.slice(target)]);
  }

  function move(playerId: string, delta: number): void {
    place(playerId, columns.order.indexOf(playerId) + delta);
  }

  /** Back to the board's own order, keeping every man the sheet holds that the board never
   *  ranked — a sheet is allowed to carry a sleeper, and matching the board must not drop him. */
  function matchBoard(): void {
    const onSheet = new Set(columns.order);
    const fromBoard = columns.boardIds.filter((id) => onSheet.has(id));
    const rest = columns.order.filter((id) => !fromBoard.includes(id));
    void reorder([...fromBoard, ...rest]);
  }

  function exportCsv(): void {
    if (selectedSheetName === null) return;
    const blob = new Blob([sheetToCsv(entries)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedSheetName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function importCsv(file: File): Promise<void> {
    if (selectedSheetId === null) return;
    const text = await file.text();
    const { rows, unresolvedNames, duplicateNames } = parseSheetCsv(text, boardOptions);
    // Fix round 1, HIGH 2: a duplicate playerId is reported through this SAME warning channel as
    // an unresolved name — both are rows the import skipped, and a manager fixing the file wants
    // to see every skipped row in one place, not learn about duplicates from a second surface.
    setUnresolved(unresolvedNames.length > 0 || duplicateNames.length > 0 ? { unresolvedNames, duplicateNames } : null);
    if (rows.length === 0) return;
    await api(`/api/draft/sheets/${selectedSheetId}/replace`, { method: "PUT", body: JSON.stringify({ entries: rows }) });
    refresh();
  }

  const matches = search.trim() === "" ? [] : boardOptions.filter((option) => option.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8);
  const onSheetIds = new Set(entries.map((entry) => entry.playerId));

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <DraftHeader stop="sheet" />
      </div>
      <div className="print:hidden">
        <ScheduledLine draft={scheduled} />
      </div>
      {/* WHICH SHEET, and what you can do to the sheet itself. One quiet row, and it sits BELOW
          the acts you take on the rows — a manager with one sheet (nearly everyone) never looks
          at it, and a red Delete above the board was the loudest thing on a page whose one verb
          is somewhere else entirely. `sheets.length < 2` hides the picker: a strip of one chip is
          a choice with nothing to choose. */}
      {sheets.length < 2 ? null : (
        <SegmentGroup label="Sheet" labelled={false} size="sm" value={selectedSheetId ?? ""} onChange={goTo} options={sheets.map((sheet) => ({ value: sheet.id, label: sheet.name }))} />
      )}

      {selectedSheetId === null ? (
        <Card className="flex flex-col gap-3 text-sm text-text-muted">
          <p>You have not started a sheet yet.</p>
          <Button className="w-fit" onClick={() => setModal("create")}>
            Start my sheet
          </Button>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Button variant="secondary" size="sm" onClick={() => seed("board")}>
              Seed from board
            </Button>
            <Button variant="secondary" size="sm" onClick={() => seed("mocks")}>
              Seed from my mocks
            </Button>
            <Button variant="secondary" size="sm" onClick={exportCsv}>
              Export CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              Import CSV
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importCsv(file);
                event.target.value = "";
              }}
            />
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              Print
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setModal("create")}>
              New sheet
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setModal("duplicate")}>
              Duplicate
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setModal("rename")}>
              Rename
            </Button>
            <Button variant="ghost" size="sm" onClick={deleteSheet}>
              Delete
            </Button>
            <div className="w-52">
              <Input label="Add a player" placeholder="Search a name to add" value={search} onChange={(event) => setSearch(event.target.value)} />
              {matches.length > 0 ? (
                <ul className="absolute z-20 mt-1 flex w-52 flex-col rounded-md border border-edge bg-surface-elevated">
                  {matches.map((option) => (
                    <li key={option.playerId}>
                      <button
                        type="button"
                        disabled={onSheetIds.has(option.playerId)}
                        onClick={() => addPlayer(option.playerId)}
                        className="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm hover:bg-surface-raised disabled:opacity-40"
                      >
                        <span>{option.name}</span>
                        <span className="text-text-faint">{onSheetIds.has(option.playerId) ? "On sheet" : "Add"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {unresolved === null ? null : (
            <Card className="flex flex-col gap-1 text-sm text-warning">
              {unresolved.unresolvedNames.length === 0 ? null : (
                <span>{`${unresolved.unresolvedNames.length} name(s) from that CSV could not be matched to a player and were skipped: ${unresolved.unresolvedNames.join(", ")}`}</span>
              )}
              {unresolved.duplicateNames.length === 0 ? null : (
                <span>{`${unresolved.duplicateNames.length} row(s) named a player already on the sheet earlier in the file; the first row won and the rest were skipped: ${unresolved.duplicateNames.join(", ")}`}</span>
              )}
            </Card>
          )}

          {/* THE SEVEN COLUMNS (founder amendment 2): the draft room's own sheet component, with
              the room-only affordances absent by prop. The columns take the whole width — they
              are the page. */}
          <div className="flex min-h-[70vh] flex-col">
            <SheetColumnsView payload={columns} basis={basis} onMove={move} onPlace={place} onMatchBoard={matchBoard} />
          </div>
          <div className="print:hidden">
            <InsightsRail
              mockHistory={insights.mockHistory}
              byeStack={insights.byeStack}
              sheetHealth={insights.sheetHealth}
              entryNamesByPlayerId={new Map(entries.map((entry) => [entry.playerId, entry.name]))}
            />
          </div>
        </>
      )}

      <Modal open={modal !== null} title={modal === "create" ? "New sheet" : modal === "rename" ? "Rename sheet" : "Duplicate sheet"} onClose={() => setModal(null)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (nameDraft.trim() === "") return;
            if (modal === "create") void createSheet(nameDraft.trim());
            else if (modal === "rename") void renameSheet(nameDraft.trim());
            else if (modal === "duplicate") void duplicateSheet(nameDraft.trim());
            setNameDraft("");
          }}
        >
          <Input label="Sheet name" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} />
          <Button type="submit">Save</Button>
        </form>
      </Modal>
    </div>
  );
}
