/** Tunables for the help/glossary system. No component may inline one of these values. */
export const HELP_CONFIG = {
  /**
   * The longest a `GLOSSARY` entry's `short` line may run. `InfoTip` prints it inline, unhidden,
   * for a `guided` reader — a short line that wraps to three lines stops being short. Enforced
   * by `glossary.test.ts` over every entry, not just the ones a reviewer happens to reread.
   */
  maxShortLength: 90,
} as const;
