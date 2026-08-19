import { z } from "zod";
import { CHAT_CONFIG, isReactionEmoji } from "@/chat/config";

export const postMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, { message: "Type a message first." })
    .max(CHAT_CONFIG.maxBodyLength, { message: `Please keep this to ${CHAT_CONFIG.maxBodyLength} characters or fewer.` }),
});

/**
 * The reaction set is validated through `isReactionEmoji`, not a second literal list here —
 * one closed set, one place it is written.
 */
export const reactionSchema = z.object({
  emoji: z.string().refine(isReactionEmoji, { message: "That isn't one of this league's reactions." }),
});

/**
 * A `chat_messages.id`: digits only, and few enough of them to fit int8.
 *
 * ONE rule, because there is one fact behind both places it is used — a message id and a page
 * cursor are the same bigserial. Anything that fails it would reach a bigint comparison as
 * `Number(...)`: `"abc"` becomes `NaN`, which Postgres refuses (`invalid input syntax for type
 * bigint: "NaN"`), and 19 digits admits values above int8's max (9223372036854775807), which
 * fails the same way. Both are malformed requests, not server faults, so they are caught here
 * rather than surfacing as a 500 and a logged database error.
 */
const MESSAGE_ID = /^\d{1,18}$/;

/** The path param on the reactions route. */
export const chatMessageIdSchema = z.string().regex(MESSAGE_ID, { message: "That isn't a message we can react to." });

/** The `?before=` page cursor — same rule, its own plain-language copy. */
export const chatCursorSchema = z.string().regex(MESSAGE_ID, { message: "That isn't a place we can load from." });
