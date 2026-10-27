/** When a lobby notice keeps the quiet way back to the lobbies (B252, review L3): only when the page
 * did not load (its room or report read failed) and the notice has no way forward of its own. A
 * failed action on a loaded page (Leave, Join another lobby, the draft against bots) sits beside the
 * page's own verb, so it gets none. Pure, so the rule is tested under node. */
import type { NoticeSubject, NoticeView } from './notice.ts';

export function keepsWayOut(
	view: Pick<NoticeView, 'verb' | 'quiet'>,
	subject: NoticeSubject,
	read: boolean
): boolean {
	return read && subject === 'lobby' && view.verb === undefined && view.quiet === undefined;
}
