"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Modal, PageTitle, SegmentGroup } from "@/components/ui";
import type { SheetSummary, SheetTag } from "./types";
import type { BoardOption, SheetEntryView } from "./view";
import type { ByeStackWarning, MockHistoryInsights, MostDraftedPlayerView } from "./insights";
import { SheetTable } from "./sheet-table";
import { InsightsRail } from "./insights-rail";
import { parseSheetCsv, sheetToCsv } from "./csv";

export interface MySheetClientProps {
  readonly sheets: readonly SheetSummary[];
  readonly selectedSheetId: string | null;
  readonly selectedSheetName: string | null;
  readonly entries: readonly SheetEntryView[];
  readonly boardOptions: readonly BoardOption[];
  readonly insights: {
    readonly mockHistory: Omit<MockHistoryInsights, "mostDrafted"> & { readonly mostDrafted: readonly MostDraftedPlayerView[] };
    readonly byeStack: ByeStackWarning | null;
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
export function MySheetClient({ sheets, selectedSheetId, selectedSheetName, entries, boardOptions, insights }: MySheetClientProps) {
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

  async function removeEntry(playerId: string): Promise<void> {
    if (selectedSheetId === null) return;
    await api(`/api/draft/sheets/${selectedSheetId}/entries?playerId=${encodeURIComponent(playerId)}`, { method: "DELETE" });
    refresh();
  }

  async function reorder(order: readonly string[]): Promise<void> {
    if (selectedSheetId === null) return;
    await api(`/api/draft/sheets/${selectedSheetId}/entries`, { method: "PUT", body: JSON.stringify({ order }) });
    refresh();
  }

  async function setNote(playerId: string, note: string): Promise<void> {
    if (selectedSheetId === null) return;
    await api(`/api/draft/sheets/${selectedSheetId}/entries`, { method: "POST", body: JSON.stringify({ playerId, note }) });
    refresh();
  }

  async function setTag(playerId: string, tag: SheetTag | null): Promise<void> {
    if (selectedSheetId === null) return;
    await api(`/api/draft/sheets/${selectedSheetId}/entries`, { method: "POST", body: JSON.stringify({ playerId, tag }) });
    refresh();
  }

  async function setTierLabel(playerId: string, tierLabel: string | null): Promise<void> {
    if (selectedSheetId === null) return;
    await api(`/api/draft/sheets/${selectedSheetId}/entries`, { method: "POST", body: JSON.stringify({ playerId, tierLabel }) });
    refresh();
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageTitle>My Sheet</PageTitle>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button variant="secondary" size="sm" onClick={() => setModal("create")}>
            New sheet
          </Button>
          {selectedSheetId === null ? null : (
            <>
              <Button variant="secondary" size="sm" onClick={() => setModal("duplicate")}>
                Duplicate
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setModal("rename")}>
                Rename
              </Button>
              <Button variant="destructive" size="sm" onClick={deleteSheet}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {sheets.length === 0 ? null : (
        <SegmentGroup label="Sheet" labelled={false} value={selectedSheetId ?? ""} onChange={goTo} options={sheets.map((sheet) => ({ value: sheet.id, label: sheet.name }))} />
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

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
            <div className="flex flex-col gap-3">
              <div className="w-64 print:hidden">
                <Input label="Add a player" placeholder="Search a name to add" value={search} onChange={(event) => setSearch(event.target.value)} />
                {matches.length > 0 ? (
                  <ul className="mt-1 flex flex-col rounded-md border border-edge bg-surface-elevated">
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
              <SheetTable entries={entries} onReorder={reorder} onRemove={removeEntry} onNote={setNote} onTag={setTag} onTierLabel={setTierLabel} />
            </div>
            <div className="print:hidden">
              <InsightsRail mockHistory={insights.mockHistory} byeStack={insights.byeStack} entryNamesByPlayerId={new Map(entries.map((entry) => [entry.playerId, entry.name]))} />
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
