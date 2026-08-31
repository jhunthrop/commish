/** The injury designation ("Q", "O", "IR") in the verdict channel — worn beside a player's name
 *  on every surface that lists him. Absent = the feed does not name him, and nothing prints.
 *  Extracted from the lineup editor when the free-agents board became its second wearer (the
 *  tab loop, 2026-08-30). */
export function DesignationChip({ designation }: { readonly designation: string | null | undefined }) {
  if (designation === null || designation === undefined) return null;
  return <span className="rounded-sm bg-negative px-1 py-0.5 font-mono text-xs font-bold leading-none text-negative-text">{designation}</span>;
}
