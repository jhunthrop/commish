/**
 * TYPES ONLY, no runtime code. Imported by `src/chat-service/**` and the `/api/leagues/[leagueId]/chat*`
 * routes as their return shape, and by `src/chat-room/**` as its prop shape, so the two sides
 * of the wire cannot drift.
 */

/** One person's one reaction. Identity is the pair — there is no counter to drift. */
export interface ChatReactionView {
  readonly emoji: string;
  readonly userId: string;
}

/**
 * A GIF attached to a message. No `id` here — that is a `GifResult`'s (`@/gifs/provider`)
 * search-time identity, not a durable property of the message; `chat_messages` stores exactly
 * these five fields (`0017_chat_message_gifs.sql`) because the shape is fixed and small.
 */
export interface ChatGif {
  readonly url: string;
  readonly previewUrl: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

export interface ChatMessageView {
  /** The `chat_messages.id` bigserial, as a string. Monotonic, so it is also the page cursor. */
  readonly id: string;
  readonly authorUserId: string;
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly reactions: readonly ChatReactionView[];
  /**
   * Null for an ordinary text message. A GIF is a `chat.message` like any other (ruling 17 — no
   * separate `chat.gif` event, no second publish path, no second client fold) with this one field
   * populated alongside `body`, which carries the GIF's alt text as a text fallback.
   */
  readonly gif: ChatGif | null;
}

export interface ChatPageBody {
  readonly leagueId: string;
  /** The caller's own id, so the client can mark its own messages and reactions. */
  readonly meUserId: string;
  /** Oldest → newest. */
  readonly messages: readonly ChatMessageView[];
  /** True when an older page exists behind `messages[0]`. */
  readonly hasMore: boolean;
  /**
   * `createGifProvider() !== null` (`@/gifs/registry`), computed server-side once per page load.
   * `ChatComposer` renders its "Add a GIF" button only when this is true — no dead button, no
   * probe of `GET /api/gifs/search` just to find out whether it exists.
   */
  readonly gifSearchEnabled: boolean;
}

/** `chat.message` payload. */
export interface ChatMessagePayload {
  readonly message: ChatMessageView;
}

/** `chat.reaction` payload. Carries the actor so the client fold is idempotent under replay. */
export interface ChatReactionPayload {
  readonly messageId: string;
  readonly emoji: string;
  readonly userId: string;
  readonly action: "added" | "removed";
}

export interface PostChatBody {
  readonly message: ChatMessageView;
}

/**
 * The TRANSITION a toggle made, not the resulting set.
 *
 * Returning the whole array would be returning a read taken after the write, which a
 * concurrent reaction can already have moved on from — and the client, holding reactions
 * folded from live frames, would make that momentary staleness durable by replacing its own
 * state with it. An action is exactly what `applyReaction` needs, so the client's own toggle
 * folds in by the same idempotent rule replay already uses.
 */
export interface ReactionBody {
  readonly messageId: string;
  readonly action: "added" | "removed";
}
