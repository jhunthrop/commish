import { z } from "zod";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { decisionIsAvailable, RESOLUTION_DECISIONS } from "@/integrity/flags";

/**
 * `POST /api/notices/read`'s body. Named `noticeIds`, not `ids`, so a rejection names the exact
 * field a caller sent — `parseJson`'s 400 quotes the first Zod issue's path, and a generic `ids`
 * would leave the caller guessing which of several possible bodies this route wanted.
 *
 * At least one id, for the same "a PATCH that asks for nothing is a 400, not a silent success"
 * reasoning `updateProfileSchema` uses (`@/identity-service/schemas`): a bare `{}` or an empty
 * array is a caller mistake worth naming, not a same-shaped no-op `markNoticesRead` would
 * quietly return 0 for anyway.
 */
export const markNoticesReadSchema = z.object({
  noticeIds: z.array(z.string()).min(1, "Send at least one notice id."),
});
// No `z.infer` alias here, deliberately (final review, LOW 14). The one this file used to export
// was named `MarkNoticesReadInput` and NAME-COLLIDED with `markNoticesRead`'s real input type in
// `@/integrity-service/notify` — two different shapes under one name, neither imported by
// anything. The route reads `parsed.value` directly, which is typed by the schema itself.



/**
 * `POST /api/admin/flags/[flagId]/resolve`'s body (Task 5's route). `flagId` is not a field here:
 * it is the URL's own path segment. `operatorUserId` is not a field here either: it is the admin
 * session `withAdmin` has already verified by the time this schema runs — a body that could name
 * a different operator would let one admin sign another admin's name to a decision.
 *
 * `decision` is narrowed past the closed `RESOLUTION_DECISIONS` enum by `decisionIsAvailable`, so
 * a request naming a decision this plan does not implement (today, only `trade_reversed`) is
 * refused HERE, at the boundary, as a 400 naming the exact field — `parseJson`'s usual shape —
 * rather than reaching `resolveFlag` and being told the same thing a second time.
 *
 * `note` shares `resolveFlag`'s own cap (`INTEGRITY_CONFIG.moderation.noteMaxLength`) rather than
 * a second number that could drift from it — `resolveFlag` still enforces it itself too, the same
 * "the service is the real boundary" discipline `removeReview`'s `REVIEW_CONFIG.removalReason`
 * check uses, so a future caller of the service directly cannot hand it an unbounded string.
 */
export const resolveFlagSchema = z.object({
  decision: z.enum(RESOLUTION_DECISIONS).refine(decisionIsAvailable, { message: "This product can't carry out that decision yet." }),
  note: z
    .string()
    .max(INTEGRITY_CONFIG.moderation.noteMaxLength, `Keep the note to ${INTEGRITY_CONFIG.moderation.noteMaxLength} characters or fewer. The member reads it.`),
});
// Likewise no `ResolveFlagBody` alias: the route hands `parsed.value.decision`/`parsed.value.note`
// straight to `resolveFlag`, whose own `ResolveFlagInput` is the type that matters.
