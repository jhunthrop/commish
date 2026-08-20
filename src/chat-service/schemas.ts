import { z } from "zod";
import { CHAT_CONFIG, isReactionEmoji } from "@/chat/config";

/**
 * A GIF the CLIENT chose and is sending back — a client-reported URL and a client-reported
 * dimension are client-controlled input, so both are validated here rather than trusted.
 * `https://` is required because the message list embeds this URL directly in an `<img>`; an
 * `http://` (or `javascript:`, `data:`, …) source is refused outright rather than sanitized.
 *
 * LENGTH IS VALIDATED TOO, not just scheme and shape. The dimensions have been bounded since
 * this schema was written; the three strings were not, so a league member could write unbounded
 * text into `chat_messages` through a field nobody was measuring. Every ceiling comes from
 * `CHAT_CONFIG.gif` — no number is inlined here.
 */
export const chatGifSchema = z.object({
  url: z
    .url()
    .max(CHAT_CONFIG.gif.maxUrlLength, { message: "That GIF's link is too long." })
    .refine((value) => value.startsWith("https://"), { message: "That GIF's link isn't secure." }),
  previewUrl: z
    .url()
    .max(CHAT_CONFIG.gif.maxUrlLength, { message: "That GIF's preview link is too long." })
    .refine((value) => value.startsWith("https://"), { message: "That GIF's preview link isn't secure." }),
  alt: z
    .string()
    .trim()
    .min(1, { message: "That GIF is missing its description." })
    .max(CHAT_CONFIG.gif.maxAltLength, { message: "That GIF's description is too long." }),
  width: z.number().int().min(CHAT_CONFIG.gif.minDimensionPx).max(CHAT_CONFIG.gif.maxDimensionPx),
  height: z.number().int().min(CHAT_CONFIG.gif.minDimensionPx).max(CHAT_CONFIG.gif.maxDimensionPx),
});

export const postMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, { message: "Type a message first." })
    .max(CHAT_CONFIG.maxBodyLength, { message: `Please keep this to ${CHAT_CONFIG.maxBodyLength} characters or fewer.` }),
  gif: chatGifSchema.optional(),
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
