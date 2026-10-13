import { getDb } from "@research-ts/db/client";
import type { MemberNotice } from "@/integrity-service/notify";
import { listNotices, quoteFor } from "@/integrity-service/notify";
import { ok } from "@/lib/api/respond";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import type { NoticesBody, NoticeView } from "@/account-room/contract";
import { noticesRateLimited } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The wire shape, narrowed from the durable row — see `NoticeView`'s own docblock for what is
 * deliberately left off (`context`, `auditEventId`) and for `quote`, the one field pulled back
 * out of `context` via the shared `quoteFor` (`@/integrity-service/notify`).
 */
function toNoticeView(notice: MemberNotice): NoticeView {
  return {
    id: notice.id,
    noticeType: notice.noticeType,
    title: notice.title,
    body: notice.body,
    quote: quoteFor(notice),
    leagueId: notice.leagueId,
    createdAt: notice.createdAt,
    readAt: notice.readAt,
  };
}

/**
 * The caller's own notices, newest first, and their unread count over that same bounded page —
 * `listNotices`' own docblock explains why the count is never over the whole table.
 *
 * There is no route anywhere that takes a user id from a request: `withCurrentUser` reads the
 * caller from the signed-in session, so "only your own notices" is a property of the code
 * rather than a check somebody could forget.
 */
export async function GET(request: Request) {
  return withCurrentUser(request, async (userId) => {
    const limited = noticesRateLimited(userId);
    if (limited !== null) return limited;

    const page = await listNotices(getDb(), userId);
    return ok<NoticesBody>({ notices: page.notices.map(toNoticeView), unreadCount: page.unreadCount });
  });
}
