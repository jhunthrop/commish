import type { AvatarPresetKey } from "@/identity";
import type { ExperienceTier } from "@/domain/user";
import type { WalletSummary } from "@/money-service/read";

/**
 * TYPES ONLY, no runtime code — mirrors `@/league-room/contract`'s own note. Imported by
 * `/api/profile` as its return shape and by `src/account-room/**` as its prop shape, so the
 * two cannot drift.
 */
export interface ProfileBody {
  readonly displayName: string;
  readonly experienceTier: ExperienceTier;
  /** The preset the user chose, or `null` if they never have — never a URL. */
  readonly avatarPreset: AvatarPresetKey | null;
  /** The STORED avatar ref (`users.avatar_url`): `Avatar`'s `avatar` prop takes this directly. */
  readonly avatar: string | null;
}

/**
 * The wire shape of one `member_notices` row, exactly what `GET /api/notices` serializes.
 * Deliberately narrower than `MemberNotice` (`@/integrity-service/notify`): `context` and
 * `auditEventId` are the service layer's own bookkeeping, not something the inbox renders —
 * `title`/`body` are already the rendered copy the reader sees, so shipping the raw context
 * beside it would be redundant, and the audit event id names an internal row this caller has
 * no route to read.
 */
export interface NoticeView {
  readonly id: string;
  readonly noticeType: string;
  readonly title: string;
  readonly body: string;
  /**
   * The ONE exception to "context stays server-side": the author-facing PHRASE that
   * `review_removed`'s stored `context.reason` maps to (`quoteFor` -> `removalPhraseFor`), split
   * out so the renderer can lay it out as a distinct blockquote rather than inline it inside
   * `body`'s own sentence — a quotation reads as one when it looks like one. Never the stored
   * value itself: since `scripts/remove-review.ts` constrained `--reason`, that value is one of
   * three platform-authored tokens (`spam`, `abusive`, `other`), and printing it put the word
   * "other" in quotation marks under "We removed your review". `null` for every notice type with
   * nothing to quote.
   */
  readonly quote: string | null;
  /** `null` for a league-less notice (e.g. a review removal) — see `NoticeContexts`'s own docblock. */
  readonly leagueId: string | null;
  readonly createdAt: string;
  /** `null` while unread. */
  readonly readAt: string | null;
}

/** `GET /api/notices`'s body: the caller's own page, newest first, plus its unread count. */
export interface NoticesBody {
  readonly notices: readonly NoticeView[];
  readonly unreadCount: number;
}

/** `GET /api/wallet`'s body (Task 12): `walletSummary` through the envelope, verbatim — the
 *  wallet page's own one data source, so a future wallet-adjacent surface (a nav balance widget,
 *  a script) reads the identical four figures rather than re-deriving them. */
export interface WalletBody {
  readonly summary: WalletSummary;
}
