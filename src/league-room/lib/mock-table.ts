/**
 * TONIGHT'S TABLE (the mock-drafts workflow pass, law 1) — the remembered mock-draft settings
 * behind the page's chip sentence, and the codec that persists them per user.
 *
 * PERSISTENCE IS THE BROWSER'S (`localStorage`, key `LEAGUE_ROOM_CONFIG.mockTableStorageKey`),
 * the same recorded judgment call the cheat sheet made (`@/draft-room/quilt/state/sheet.ts`):
 * no server table for draft prep exists, and losing a remembered table to a cleared browser
 * loses one tap of preference, never money or picks.
 *
 * `decodeMockTable` trusts nothing: localStorage is external data (review LOW 5's rule), so
 * every field is validated against the OFFERED options — the same lists the server's own
 * `createMockRoomSchema` refines against, threaded here as `MockTableOptions` — and any field
 * off its list quietly reads as the default. An options change (a retired clock, say) therefore
 * heals a stale store instead of posting a body the server would refuse.
 */

export interface MockTable {
  readonly teamCount: number;
  readonly pickSeconds: number;
  readonly scoringPreset: string;
  readonly rosterShape: string;
  /** 1-based seat, or null for the schema's own silent random draw. */
  readonly draftSlot: number | null;
  /** The host's team name; "" means unset (the server falls back to the profile name). */
  readonly teamName: string;
}

export interface MockTableOptions {
  readonly teamCounts: readonly number[];
  readonly pickSeconds: readonly number[];
  readonly scoringPresets: readonly string[];
  readonly rosterShapes: readonly string[];
  readonly defaultTeamCount: number;
  readonly defaultPickSeconds: number;
  readonly defaultScoringPreset: string;
  readonly defaultRosterShape: string;
  readonly maxTeamNameLength: number;
}

export function defaultMockTable(options: MockTableOptions): MockTable {
  return {
    teamCount: options.defaultTeamCount,
    pickSeconds: options.defaultPickSeconds,
    scoringPreset: options.defaultScoringPreset,
    rosterShape: options.defaultRosterShape,
    draftSlot: null,
    teamName: "",
  };
}

export function encodeMockTable(table: MockTable): string {
  return JSON.stringify(table);
}

function numberOn(list: readonly number[], value: unknown, fallback: number): number {
  return typeof value === "number" && list.includes(value) ? value : fallback;
}

function stringOn(list: readonly string[], value: unknown, fallback: string): string {
  return typeof value === "string" && list.includes(value) ? value : fallback;
}

export function decodeMockTable(raw: string | null, options: MockTableOptions): MockTable {
  const defaults = defaultMockTable(options);
  if (raw === null) return defaults;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (typeof parsed !== "object" || parsed === null) return defaults;
  const stored = parsed as Partial<Record<keyof MockTable, unknown>>;
  const teamCount = numberOn(options.teamCounts, stored.teamCount, defaults.teamCount);
  const draftSlot =
    typeof stored.draftSlot === "number" && Number.isInteger(stored.draftSlot) && stored.draftSlot >= 1 && stored.draftSlot <= teamCount
      ? stored.draftSlot
      : null;
  return {
    teamCount,
    pickSeconds: numberOn(options.pickSeconds, stored.pickSeconds, defaults.pickSeconds),
    scoringPreset: stringOn(options.scoringPresets, stored.scoringPreset, defaults.scoringPreset),
    rosterShape: stringOn(options.rosterShapes, stored.rosterShape, defaults.rosterShape),
    draftSlot,
    teamName: typeof stored.teamName === "string" ? stored.teamName.slice(0, options.maxTeamNameLength) : "",
  };
}

/** A table change that shrinks the room below a chosen seat resets the seat to random rather
 *  than clamping — the reader never sees a silently renumbered choice they never made (the
 *  same rule the old setup form kept). */
export function withTeamCount(table: MockTable, teamCount: number): MockTable {
  return {
    ...table,
    teamCount,
    draftSlot: table.draftSlot !== null && table.draftSlot > teamCount ? null : table.draftSlot,
  };
}

/** The POST body `DRAFT NOW` and both people doors send — the remembered table spoken in
 *  `createMockRoomSchema`'s own vocabulary, silent fields omitted the way the schema expects. */
export function createRequestFor(table: MockTable, mode: string): Record<string, unknown> {
  return {
    mode,
    teamCount: table.teamCount,
    pickSeconds: table.pickSeconds,
    scoringPreset: table.scoringPreset,
    rosterShape: table.rosterShape,
    ...(table.teamName.trim().length > 0 ? { teamName: table.teamName.trim() } : {}),
    ...(table.draftSlot !== null ? { draftSlot: table.draftSlot } : {}),
  };
}

/** Which chip is open for editing — the sentence's own borrow-and-return state. */
export type MockTableChipId = "teams" | "clock" | "scoring" | "roster" | "seat" | "name";

export interface MockTableChip {
  readonly id: MockTableChipId;
  /** Sentence-case data; the chip row renders it through `MICRO_LABEL`, which is where caps
   *  come from (the caps charter's one sanctioned register). */
  readonly label: string;
}

/**
 * The sentence itself: one chip per setting, in the blueprint's own order. The NAME chip rides
 * only when a name is set — an unset name is the server's own silent fallback, and a chip that
 * says "name: none" would be the settings form creeping back in.
 */
export function tableChips(
  table: MockTable,
  labels: { readonly scoring: ReadonlyMap<string, string>; readonly roster: ReadonlyMap<string, string> },
): readonly MockTableChip[] {
  const chips: MockTableChip[] = [
    { id: "teams", label: `${table.teamCount} teams` },
    { id: "clock", label: `${table.pickSeconds}s clock` },
    { id: "scoring", label: labels.scoring.get(table.scoringPreset) ?? table.scoringPreset },
    { id: "roster", label: labels.roster.get(table.rosterShape) ?? table.rosterShape },
    { id: "seat", label: table.draftSlot === null ? "Seat: random" : `Seat: ${table.draftSlot}` },
  ];
  if (table.teamName.trim().length > 0) chips.push({ id: "name", label: table.teamName.trim() });
  return chips;
}
