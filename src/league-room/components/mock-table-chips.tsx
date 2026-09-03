"use client";

import { useState } from "react";
import { Button, Input, SegmentGroup } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { ROSTER_SHAPE_LABEL } from "@/domain/roster";
import { formatOrdinal } from "@/draft-room/state/format";
import {
  tableChips,
  withTeamCount,
  type MockTable,
  type MockTableChipId,
  type MockTableOptions,
} from "../lib/mock-table";
import { PRESETS } from "./create-league-form";

/**
 * TONIGHT'S TABLE, AS A SENTENCE OF CHIPS (the workflow pass, law 1): the seven-decision setup
 * form, retired into one quiet line — "12 teams · 60s clock · Half PPR · Standard · Seat:
 * random · Name: auto" — each chip tappable to change IN PLACE. Tapping a chip borrows one row
 * directly beneath the sentence for that setting's own editor (the room's borrow-and-return
 * pattern — no navigation, no form column), and choosing returns the row.
 *
 * The option vocabularies are the SAME tables the old form read (`PRESETS` from the create
 * form, `ROSTER_SHAPE_LABEL` from the browser-safe roster domain, the offered counts and clocks
 * threaded from `MOCK_CONFIG` by the server page) — one vocabulary, never a parallel picker.
 */

/** value → label, for the chip sentence and both segment editors. */
export const SCORING_LABELS: ReadonlyMap<string, string> = new Map(PRESETS.map((preset) => [preset.value, preset.label]));
export const ROSTER_LABELS: ReadonlyMap<string, string> = new Map(Object.entries(ROSTER_SHAPE_LABEL));

/** This surface's own control words — labels, not the pre-vetted sentences `MOCK_COPY` guards
 *  (the same split `MockLobby`'s old `MODE_ROW_LABEL` recorded for this directory). */
const CHIP_EDITOR_LABEL: Readonly<Record<MockTableChipId, string>> = {
  teams: "Teams",
  clock: "Pick clock",
  scoring: "Scoring",
  roster: "Roster shape",
  seat: "Your seat",
  name: "Team name",
};

export interface MockTableChipsProps {
  readonly table: MockTable;
  readonly options: MockTableOptions;
  /** `MOCK_COPY.tableHint`, threaded from the server page (ruling 8). */
  readonly hint: string;
  readonly onChange: (table: MockTable) => void;
}

const RANDOM_SEAT = "";

export function MockTableChips({ table, options, hint, onChange }: MockTableChipsProps) {
  const [openChip, setOpenChip] = useState<MockTableChipId | null>(null);
  // The seat draw's polite announcement (E3's fix, carried from the retired setup form): a
  // sighted reader sees the pressed pill change; a screen reader hears the drawn seat.
  const [rolledAnnouncement, setRolledAnnouncement] = useState<string | null>(null);

  const change = (next: MockTable, close = true): void => {
    onChange(next);
    if (close) setOpenChip(null);
  };

  const seatOptions: readonly { readonly value: string; readonly label: string }[] = [
    { value: RANDOM_SEAT, label: "Random" },
    ...Array.from({ length: table.teamCount }, (_, index) => index + 1).map((seat) => ({
      value: String(seat),
      label: String(seat),
    })),
  ];

  /** Founder follow-up (2026-08-26), kept: a visible roll for people who want the draw now. A
   *  plain `Math.random()` is fine — this sets a value the person sees and can still change. */
  const rollSeat = (): void => {
    const seat = Math.floor(Math.random() * table.teamCount) + 1;
    change({ ...table, draftSlot: seat }, false);
    setRolledAnnouncement(`Seat ${formatOrdinal(seat)}`);
  };

  const editor =
    openChip === null ? null : (
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-surface-elevated p-3">
        {openChip === "teams" ? (
          <SegmentGroup
            label={CHIP_EDITOR_LABEL.teams}
            options={options.teamCounts.map((count) => ({ value: String(count), label: String(count) }))}
            value={String(table.teamCount)}
            onChange={(value) => change(withTeamCount(table, Number(value)))}
          />
        ) : null}
        {openChip === "clock" ? (
          <SegmentGroup
            label={CHIP_EDITOR_LABEL.clock}
            options={options.pickSeconds.map((seconds) => ({ value: String(seconds), label: `${seconds}s` }))}
            value={String(table.pickSeconds)}
            onChange={(value) => change({ ...table, pickSeconds: Number(value) })}
          />
        ) : null}
        {openChip === "scoring" ? (
          <SegmentGroup
            label={CHIP_EDITOR_LABEL.scoring}
            options={options.scoringPresets.map((value) => ({ value, label: SCORING_LABELS.get(value) ?? value }))}
            value={table.scoringPreset}
            onChange={(value) => change({ ...table, scoringPreset: value })}
          />
        ) : null}
        {openChip === "roster" ? (
          <SegmentGroup
            label={CHIP_EDITOR_LABEL.roster}
            options={options.rosterShapes.map((value) => ({ value, label: ROSTER_LABELS.get(value) ?? value }))}
            value={table.rosterShape}
            onChange={(value) => change({ ...table, rosterShape: value })}
          />
        ) : null}
        {openChip === "seat" ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text-primary">{CHIP_EDITOR_LABEL.seat}</span>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={CHIP_EDITOR_LABEL.seat}>
              {seatOptions.map((option) => {
                const pressed = option.value === (table.draftSlot === null ? RANDOM_SEAT : String(table.draftSlot));
                return (
                  <button
                    key={option.value === RANDOM_SEAT ? "random" : option.value}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => change({ ...table, draftSlot: option.value === RANDOM_SEAT ? null : Number(option.value) })}
                    className={`min-w-9 rounded-md border px-2 py-1.5 font-display text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      pressed ? "border-accent text-accent" : "border-line text-text-muted hover:text-text-primary"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
              <Button type="button" variant="ghost" size="sm" onClick={rollSeat}>
                Roll it
              </Button>
            </div>
          </div>
        ) : null}
        {openChip === "name" ? (
          <>
            <Input
              className="max-w-sm"
              label={CHIP_EDITOR_LABEL.name}
              value={table.teamName}
              maxLength={options.maxTeamNameLength}
              onChange={(event) => change({ ...table, teamName: event.target.value }, false)}
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpenChip(null)}>
              Done
            </Button>
          </>
        ) : null}
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`${MICRO_LABEL} text-text-faint`}>Tonight&apos;s table:</span>
        {tableChips(table, { scoring: SCORING_LABELS, roster: ROSTER_LABELS }).map((chip) => (
          <button
            key={chip.id}
            type="button"
            data-testid={`table-chip-${chip.id}`}
            aria-expanded={openChip === chip.id}
            aria-label={`${CHIP_EDITOR_LABEL[chip.id]}: ${chip.label}`}
            onClick={() => setOpenChip((current) => (current === chip.id ? null : chip.id))}
            className={`${MICRO_LABEL} rounded-md border bg-surface px-3 py-1.5 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              openChip === chip.id ? "border-accent text-accent" : "border-line text-text-muted hover:text-text-primary"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-text-faint">{hint}</p>
      {editor}
      <span className="sr-only" aria-live="polite">
        {rolledAnnouncement}
      </span>
    </div>
  );
}
