"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Modal } from "@/components/ui";
import { DraftHeader } from "@/draft-hq/draft-header";
import { ScheduledLine, type ScheduledDraft } from "@/draft-hq/scheduled-line";
import type { SheetSummary, SheetTag } from "./types";
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
  /** One sentence: whose rules every number on a row is under (`basisSentence`). */
  readonly basis: string;
  /** `?league=`/`?format=` as the switch must carry them, so a stop change moves the view and
   *  not the numbers (fix round 1, H3). */
  readonly headerQuery: Readonly<Record<string, string>>;
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
export function MySheetClient({ sheets, selectedSheetId, selectedSheetName, entries, boardOptions, columns, basis, headerQuery, scheduled, insights }: MySheetClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [modal, setModal] = useState<ModalKind>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [search, setSearch] = useState("");
  const [sheetsOpen, setSheetsOpen] = useState(false);
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

  /** THE ROW'S OWN MARKS (fix round 1, H2) — the same three POSTs and one DELETE the retired
   *  table held, reached from the row itself now rather than from a second list. */
  function setNote(playerId: string, note: string): void {
    if (selectedSheetId === null) return;
    void api(`/api/draft/sheets/${selectedSheetId}/entries`, { method: "POST", body: JSON.stringify({ playerId, note }) }).then(refresh);
  }

  function setTag(playerId: string, tag: SheetTag | null): void {
    if (selectedSheetId === null) return;
    void api(`/api/draft/sheets/${selectedSheetId}/entries`, { method: "POST", body: JSON.stringify({ playerId, tag }) }).then(refresh);
  }

  function setTierLabel(playerId: string, tierLabel: string | null): void {
    if (selectedSheetId === null) return;
    void api(`/api/draft/sheets/${selectedSheetId}/entries`, { method: "POST", body: JSON.stringify({ playerId, tierLabel }) }).then(refresh);
  }

  function removeEntry(playerId: string): void {
    if (selectedSheetId === null) return;
    void api(`/api/draft/sheets/${selectedSheetId}/entries?playerId=${encodeURIComponent(playerId)}`, { method: "DELETE" }).then(refresh);
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
        <DraftHeader stop="sheet" query={headerQuery} />
      </div>
      <ScheduledLine draft={scheduled} />
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
            {/* SHEETS FOLDS BEHIND ONE CONTROL (fix round 1, M5). Holding more than one sheet is
                real and stays; naming four ways to manage a thing beside five ways to use it was
                ten controls on a line the mock drew five on. The word names the noun, the panel
                under it names the acts, and a manager with one sheet reads one word. */}
            <Button variant="ghost" size="sm" aria-expanded={sheetsOpen} onClick={() => setSheetsOpen((was) => !was)}>
              {`Sheets (${sheets.length})`}
            </Button>
            <div className="w-52">
              <Input label="Add a player" labelHidden placeholder="Search a name to add" value={search} onChange={(event) => setSearch(event.target.value)} />
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

          {!sheetsOpen ? null : (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-elevated p-3 shadow-card print:hidden">
              {sheets.map((sheet) => (
                <Button key={sheet.id} size="sm" variant={sheet.id === selectedSheetId ? "secondary" : "ghost"} aria-current={sheet.id === selectedSheetId ? "true" : undefined} onClick={() => goTo(sheet.id)}>
                  {`${sheet.name} · ${sheet.entryCount}`}
                </Button>
              ))}
              <span className="flex-1" />
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
            </div>
          )}

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
              the room-only affordances absent by prop.

              THE RAIL SITS BESIDE THEM ON A DESKTOP (fix round 1, M6). Under the columns it was
              below a 70vh scroller and nobody ever reached it, which is the same as deleting it —
              and bye stacks and sheet health are real measured facts. On a narrower screen the
              columns need every pixel and it goes back underneath, where a scroll does reach it. */}
          <div className="grid min-h-[70vh] grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="flex min-h-[70vh] min-w-0 flex-col">
              <SheetColumnsView
                payload={columns}
                basis={basis}
                onMove={move}
                onPlace={place}
                onMatchBoard={matchBoard}
                onNote={setNote}
                onTag={setTag}
                onTierLabel={setTierLabel}
                onRemove={removeEntry}
              />
            </div>
            <div className="print:hidden">
              <InsightsRail
                mockHistory={insights.mockHistory}
                byeStack={insights.byeStack}
                sheetHealth={insights.sheetHealth}
                entryNamesByPlayerId={new Map(entries.map((entry) => [entry.playerId, entry.name]))}
              />
            </div>
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
