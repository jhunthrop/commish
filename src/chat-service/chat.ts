import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { ChatGif, ChatMessageRemoval, ChatMessageView, ChatReactionView } from "@/chat/contract";
import { CHAT_CONFIG } from "@/chat/config";
import type { Db } from "@research/db/client";
import { chatMessages, chatReactions, teams, users } from "@/db/schema";
import type { RealtimeEventType } from "@/lib/realtime/events";
import type { PublishFn } from "@/lib/realtime/publish";

/**
 * Exported (Task 6): `@/chat-service/moderation`'s `removeChatMessageInTx` builds one of these
 * from its own author/team lookup so it can hand the SAME `toView` below the row it needs to
 * publish a removal exactly the way `postMessage` publishes a new message — one mapper, not two
 * that could drift on which columns decide `removal`.
 */
export interface MessageRow {
  readonly id: number;
  readonly authorUserId: string;
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
  readonly body: string;
  readonly createdAt: Date;
  readonly kind: "text" | "gif";
  readonly gifUrl: string | null;
  readonly gifPreviewUrl: string | null;
  readonly gifAlt: string | null;
  readonly gifWidth: number | null;
  readonly gifHeight: number | null;
  /**
   * Null for a message that stands. There is deliberately NO `removalReason` on this row shape:
   * the reason never becomes part of a `ChatMessageView`, so the one mapper that builds the wire
   * view is never handed it in the first place (final review, HIGH 1). `removeChatMessageInTx`
   * reads the reason straight off its own `UPDATE ... RETURNING` for the author's private notice.
   */
  readonly removedAt: Date | null;
}

/** Null unless every one of the five columns is populated — `kind` alone is not trusted over the columns actually being there. Also null once the message is removed — see `toView` below. */
function toGifView(row: MessageRow): ChatGif | null {
  if (row.kind !== "gif" || row.gifUrl === null || row.gifPreviewUrl === null || row.gifAlt === null || row.gifWidth === null || row.gifHeight === null) {
    return null;
  }
  return { url: row.gifUrl, previewUrl: row.gifPreviewUrl, alt: row.gifAlt, width: row.gifWidth, height: row.gifHeight };
}

/**
 * `at` and nothing else — see `ChatMessageRemoval`'s own docblock. This object reaches every
 * member of the room, so a reason on it would be a public accusation; the reason reaches the
 * author alone, through their private `chat_message_removed` notice.
 */
function toRemoval(row: MessageRow): ChatMessageRemoval | null {
  return row.removedAt === null ? null : { at: row.removedAt.toISOString() };
}

/**
 * Exported (Task 6) for `removeChatMessageInTx`'s own reuse — one row-to-wire mapping, shared by
 * every writer of a `ChatMessageView` (a new message, a page read, a removal), so `body`/`gif`
 * being withheld once `removal !== null` is a rule enforced in exactly one place.
 */
export function toView(row: MessageRow, reactions: readonly ChatReactionView[]): ChatMessageView {
  const removal = toRemoval(row);
  return {
    id: String(row.id),
    authorUserId: row.authorUserId,
    authorName: row.authorName,
    authorAvatarUrl: row.authorAvatarUrl,
    // The wire does not carry a removed message's words (ChatMessageView.removal's own
    // docblock) — the row itself keeps them, exactly as `reviews` preserves a removed review's
    // body. `RemovedMessage` renders its own neutral tombstone sentence instead; nothing reads
    // `body` once `removal !== null`.
    body: removal === null ? row.body : "",
    createdAt: row.createdAt.toISOString(),
    reactions,
    gif: removal === null ? toGifView(row) : null,
    removal,
  };
}

/** Where a swallowed publish failure goes. Mirrors `DraftStoreDeps.onPublishError` in shape. */
export type PublishErrorSink = (
  error: unknown,
  event: { readonly type: RealtimeEventType; readonly leagueId: string },
) => void;

const defaultOnPublishError: PublishErrorSink = (error, event) => {
  console.error("[chat] publish failed", { type: event.type, leagueId: event.leagueId, error });
};

/**
 * Publishing is best-effort BY CONTRACT: the row is already committed and Postgres is
 * authoritative, so a Redis outage must never make an accepted message look rejected. The
 * publisher itself already swallows its own failures; this guard covers an injected publisher
 * that doesn't.
 *
 * The error sink defaults to `console.error` (today's only production behavior) but is
 * injectable, mirroring the draft store's `onPublishError` — so a caller (or a test) can
 * observe the swallow without spying on the global console.
 *
 * Exported (Task 6): `@/chat-service/moderation`'s `removeChatMessageInTx` reuses this exact
 * swallow rather than a second copy of it — a removal frame's publish failure must be exactly as
 * silent as a new message's.
 */
export async function publishQuietly(
  publish: PublishFn,
  input: Parameters<PublishFn>[0],
  onPublishError: PublishErrorSink = defaultOnPublishError,
): Promise<void> {
  try {
    await publish(input);
  } catch (error: unknown) {
    onPublishError(error, { type: input.type, leagueId: input.leagueId });
  }
}

async function reactionsFor(db: Db, messageIds: readonly number[]): Promise<ReadonlyMap<number, readonly ChatReactionView[]>> {
  const grouped = new Map<number, ChatReactionView[]>();
  if (messageIds.length === 0) return grouped;
  const rows = await db
    .select({ messageId: chatReactions.messageId, emoji: chatReactions.emoji, userId: chatReactions.userId })
    .from(chatReactions)
    .where(inArray(chatReactions.messageId, [...messageIds]));
  for (const row of rows) {
    const held = grouped.get(row.messageId) ?? [];
    held.push({ emoji: row.emoji, userId: row.userId });
    grouped.set(row.messageId, held);
  }
  return grouped;
}

export interface PostMessageInput {
  readonly leagueId: string;
  readonly userId: string;
  readonly body: string;
  readonly publish: PublishFn;
  /** Present exactly when this message is a GIF — `postMessage` writes both `body` and this in one insert. See ruling 17: a GIF is a `chat.message`, never a second event type. */
  readonly gif?: ChatGif;
  /** Defaults to logging via `console.error`. Override in tests to assert the swallow. */
  readonly onPublishError?: PublishErrorSink;
}

/** Persist first, publish second — the order every write in this codebase uses. */
export async function postMessage(db: Db, input: PostMessageInput): Promise<ChatMessageView> {
  const [author] = await db
    .select({ displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, input.userId));
  // You talk as your TEAM in a league's chat, not as your legal name (persona review: real
  // names kill the trash-talk energy and leak identity in a money league). Display name is
  // only the fallback for a teamless commissioner.
  const [team] = await db
    .select({ name: teams.name })
    .from(teams)
    .where(and(eq(teams.leagueId, input.leagueId), eq(teams.userId, input.userId)));

  const [row] = await db
    .insert(chatMessages)
    .values({
      leagueId: input.leagueId,
      authorUserId: input.userId,
      body: input.body,
      kind: input.gif === undefined ? "text" : "gif",
      gifUrl: input.gif?.url ?? null,
      gifPreviewUrl: input.gif?.previewUrl ?? null,
      gifAlt: input.gif?.alt ?? null,
      gifWidth: input.gif?.width ?? null,
      gifHeight: input.gif?.height ?? null,
    })
    .returning({ id: chatMessages.id, createdAt: chatMessages.createdAt });

  const message = toView(
    {
      id: row!.id,
      authorUserId: input.userId,
      authorName: team?.name ?? author?.displayName ?? "A manager",
      authorAvatarUrl: author?.avatarUrl ?? null,
      body: input.body,
      createdAt: row!.createdAt,
      kind: input.gif === undefined ? "text" : "gif",
      gifUrl: input.gif?.url ?? null,
      gifPreviewUrl: input.gif?.previewUrl ?? null,
      gifAlt: input.gif?.alt ?? null,
      gifWidth: input.gif?.width ?? null,
      gifHeight: input.gif?.height ?? null,
      // A message this call just created has never been removed.
      removedAt: null,
    },
    [],
  );

  await publishQuietly(input.publish, { leagueId: input.leagueId, type: "chat.message", payload: { message } }, input.onPublishError);
  return message;
}

export interface ListMessagesInput {
  readonly leagueId: string;
  /** A message id; the page returned is the newest `pageSize` messages strictly older than it. */
  readonly before?: string;
}

export interface ChatPage {
  readonly messages: readonly ChatMessageView[];
  readonly hasMore: boolean;
}

/**
 * THE chat page read, as a builder rather than inline in `listMessages` — exported for the same
 * reason `browseQuery` and `pendingFlagQuery` are: `src/db/index-plans.test.ts` measures its
 * EXPLAIN plan, and it can only do that honestly against the STATEMENT PRODUCTION MAKES.
 *
 * Final review, HIGH 3: that test used to build a four-column, join-free, `ORDER BY id ASC`
 * stand-in and call it "the chat page's own read, exactly as `listMessages` makes it". It was
 * none of those things, so it measured an Index-Only Scan on a covering index the real query
 * (eleven columns, two joins, `ORDER BY id DESC`) never uses. One builder, one measurement, no
 * resemblance.
 */
export function chatPageQuery(db: Db, input: ListMessagesInput) {
  const scope =
    input.before === undefined
      ? eq(chatMessages.leagueId, input.leagueId)
      : and(eq(chatMessages.leagueId, input.leagueId), lt(chatMessages.id, Number(input.before)));

  return db
    .select({
      id: chatMessages.id,
      authorUserId: chatMessages.authorUserId,
      authorName: teams.name,
      authorFallbackName: users.displayName,
      authorAvatarUrl: users.avatarUrl,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
      kind: chatMessages.kind,
      gifUrl: chatMessages.gifUrl,
      gifPreviewUrl: chatMessages.gifPreviewUrl,
      gifAlt: chatMessages.gifAlt,
      gifWidth: chatMessages.gifWidth,
      gifHeight: chatMessages.gifHeight,
      removedAt: chatMessages.removedAt,
    })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.authorUserId))
    // Team identity, same rule as postMessage: you speak as your team in this league.
    .leftJoin(teams, and(eq(teams.leagueId, chatMessages.leagueId), eq(teams.userId, chatMessages.authorUserId)))
    .where(scope)
    .orderBy(desc(chatMessages.id))
    .limit(CHAT_CONFIG.pageSize + 1);
}

/**
 * One page, newest-first from the database and reversed to oldest-first for rendering. There
 * is deliberately no unpaginated read: chat is the one table in this product that grows
 * without bound, so an "all messages" query would be a slow query waiting for its first busy
 * league. `pageSize + 1` is fetched so `hasMore` costs no second round trip.
 */
export async function listMessages(db: Db, input: ListMessagesInput): Promise<ChatPage> {
  const rows = await chatPageQuery(db, input);

  const hasMore = rows.length > CHAT_CONFIG.pageSize;
  const page = hasMore ? rows.slice(0, CHAT_CONFIG.pageSize) : rows;
  const grouped = await reactionsFor(db, page.map((row) => row.id));

  return {
    messages: [...page]
      .reverse()
      .map((row) => toView({ ...row, authorName: row.authorName ?? row.authorFallbackName }, grouped.get(row.id) ?? [])),
    hasMore,
  };
}

export type ToggleReactionResult =
  | { readonly ok: true; readonly action: "added" | "removed" }
  | { readonly ok: false; readonly status: number; readonly reason: string };

export interface ToggleReactionInput {
  readonly leagueId: string;
  readonly messageId: string;
  readonly userId: string;
  readonly emoji: string;
  readonly publish: PublishFn;
  /** Defaults to logging via `console.error`. Override in tests to assert the swallow. */
  readonly onPublishError?: PublishErrorSink;
}

/**
 * A reaction is a toggle, resolved by which write THIS call actually landed — never by a prior
 * read, which is what let two concurrent double-taps both conclude "nothing here yet, I must be
 * adding" and both publish "added" for a single physical row.
 *
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING` is one atomic statement: under any concurrent
 * double-tap, the unique index on `(message_id, user_id, emoji)` guarantees at most one caller's
 * insert ever returns a row. That caller — and only that caller — reports "added". Every other
 * caller sees the conflict (which Postgres cannot report until the winning insert has actually
 * committed) and falls through to the DELETE, so a caller can never mistake a just-committed
 * insert for an empty table.
 *
 * The DELETE is judged the same way: by its own returned rows, not assumed. If two callers both
 * fall through to it for the same row, Postgres serializes the two DELETEs and only the first to
 * acquire the row lock actually removes anything; the second's DELETE affects zero rows because
 * there is nothing left to delete. That second caller did not cause a transition — the first
 * caller already published "removed" — so it reports the true resulting state ("removed", since
 * the row is in fact gone) but skips the publish. Publishing there would be a phantom duplicate
 * of a change this call never made.
 *
 * The message is re-read scoped to the LEAGUE first: a member of league A must not be able to
 * react onto a message in league B by guessing its id — the route's membership gate proves who
 * you are, this proves the message is one you were allowed to see.
 *
 * THE SELECT/INSERT/DELETE NOW SHARE ONE TRANSACTION — a FLAKE reduction, not a correctness fix
 * (Plan B's own final review adjudicated this and carried it here in writing). Un-transacted, the
 * three statements could interleave with another connection's own three under pooler load and
 * produce a spurious frame; they never produced torn state, because the verdict above was always
 * read from each write's own `RETURNING` rows, never from a prior read — that property is
 * unchanged by wrapping them, and the test below pins it so a future edit cannot quietly swap it
 * for a read-then-write shape instead.
 */
export async function toggleReaction(db: Db, input: ToggleReactionInput): Promise<ToggleReactionResult> {
  const messageId = Number(input.messageId);

  const outcome = await db.transaction(async (tx) => {
    const [message] = await tx
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(and(eq(chatMessages.id, messageId), eq(chatMessages.leagueId, input.leagueId)));
    if (message === undefined) return { ok: false as const, status: 404, reason: "That message is no longer here." };

    const inserted = await tx
      .insert(chatReactions)
      .values({ messageId, userId: input.userId, emoji: input.emoji })
      .onConflictDoNothing()
      .returning({ emoji: chatReactions.emoji });

    const didAdd = inserted.length > 0;
    const didRemove = didAdd
      ? false
      : (
          await tx
            .delete(chatReactions)
            .where(and(eq(chatReactions.messageId, messageId), eq(chatReactions.userId, input.userId), eq(chatReactions.emoji, input.emoji)))
            .returning({ emoji: chatReactions.emoji })
        ).length > 0;

    return { ok: true as const, didAdd, didRemove };
  });

  if (!outcome.ok) return outcome;
  const { didAdd, didRemove } = outcome;

  // "removed" whenever this call didn't add it — whether this call's own DELETE removed it or
  // a concurrent caller's did. Both are honestly reported as "removed": it is the true
  // resulting state either way. The route's only consumer is this action, not a snapshot of the
  // reaction set — the client already holds its own copy and folds the transition into it
  // (`applyReaction`), so there is no second read of `reactionsFor` to build one here.
  const action: "added" | "removed" = didAdd ? "added" : "removed";

  // Only a write THIS call actually made gets published — never the phantom no-op where a
  // concurrent caller's DELETE already won and already published the same transition.
  if (didAdd || didRemove) {
    await publishQuietly(
      input.publish,
      { leagueId: input.leagueId, type: "chat.reaction", payload: { messageId: input.messageId, emoji: input.emoji, userId: input.userId, action } },
      input.onPublishError,
    );
  }

  return { ok: true, action };
}
