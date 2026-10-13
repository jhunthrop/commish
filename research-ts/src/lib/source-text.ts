/**
 * `source` with every comment blanked but every newline kept, so an offender keeps its line
 * number. Shared by every class-spelling sweep (`accent-budget`, `magnitude-budget`) for the
 * carve-out they all make: `badge.tsx`'s docblock retells the history of an accent fill it no
 * longer renders, and prose is not a rendered class.
 */
export function stripCommentsPreservingLines(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");
}
