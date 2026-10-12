/**
 * THE REGISTER'S REFUSALS, TYPED (job-system fix round, HIGH-1). `takeFreeze` refuses for a
 * closed set of causes, and the job system must treat every one of them as TERMINAL — retrying a
 * freeze until it lands late would paper over the exact gates the register exists to enforce.
 * Before this class, the job layer recognised refusals by regex over `Error.message`, which a
 * message edit silently desyncs; `instanceof RegisterRefusalError` cannot drift, and the `code`
 * names the cause without anyone parsing prose.
 *
 * Lives inside `register/` on purpose: the refusal vocabulary is the register's own law, and this
 * placement keeps the wall untouched — only wall-exempt files import it directly, and the job
 * definition reaches the CLASS through `src/projections/season-week/steps.ts`'s sanctioned re-export.
 */
export type RegisterRefusalCode =
  /** The week has already begun; a freeze now would not be a prospective claim. */
  | "past_kickoff"
  /** The served board holds no rows at the freeze instant; run preseason:persist first. */
  | "empty_served_board"
  /** `register/sources.ts` lists no board with the `served` role — a config bug. */
  | "no_served_role"
  /** The store holds no ingested kickoff for the requested week; run projections:context first. */
  | "no_kickoff"
  /** A board carries more than one `as_of` generation at the freeze instant
   *  (`assertSingleGeneration`, wrapped by `takeFreeze` so the freeze path always carries a
   *  typed refusal without touching board-store's own error). */
  | "stitched_generations";

export class RegisterRefusalError extends Error {
  readonly code: RegisterRefusalCode;

  constructor(code: RegisterRefusalCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "RegisterRefusalError";
    this.code = code;
  }
}
