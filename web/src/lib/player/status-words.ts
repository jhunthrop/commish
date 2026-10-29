/** The words over a week read his designation moved past (Lane 162, D01; Lane 274): one source for the
 * web and both apps (shared/words/player-status-held.json), and the run's own (`capsules/week/caption.py
 * status_changed_caption`, held to these by research/tests/test_status_words_drift.py). Kept apart from
 * status-held.ts so the shelf's script carries the words and none of the build rule; the change test is here
 * too, as the card judges a live read by it (Lane 284). */
import type { Designations, PlayerStatus, WeekRead } from '#lib/run/schema.ts';

/** How the run's status-changed caption opens, whatever due time it names, capped or not. Once his game
 * is under way no new read comes for it, so the caption is this sentence alone. */
const CHANGED_LEAD = 'His status changed since this read was written.';
/** What follows the lead, before the due time. */
const DUE_BY = 'A new read is due by';

export const STATUS_HELD_WORDS = {
	changedLead: CHANGED_LEAD,
	dueBy: DUE_BY,
	/** The caption over a read his status moved past, with the next write's time. */
	changed: (due: string): string => `${CHANGED_LEAD} ${DUE_BY} ${due}.`
} as const;

/** Whether a caption is the status-changed one, with or without its due time. */
export function isStatusCaption(caption: string): boolean {
	return caption.startsWith(CHANGED_LEAD);
}

/** When the capture was last read: its check, else its stamp (the page's "read" instant). */
export function lastRead(capture: Pick<Designations, 'readAt' | 'checkedAt'>): number {
	return Date.parse(capture.checkedAt ?? capture.readAt);
}

/** Whether his designation changed since the read was written. Only a capture read after the write can
 * say so (one read before it is the list the writer read, or an older one); then another status than
 * the one the read was written against (a player due back this week reads questionable where the read
 * says IR), or the same status in a run that began after the read (`since`, the first capture of his
 * unbroken run), is a change. A `returning` day is only ever set on a questionable player (schema.ts), so a
 * read written against another status always differs by status. The one case this does not see, a read
 * written while he was questionable and given a `returning` day since with the status unchanged, stands:
 * the writer's rules refuse a read that keeps a returning player out at the next pass (rules.py
 * `_returning_violations`), and the hourly build is the only refresh of this judgement (it is decided at
 * the build's clock, as the run's own is). */
export function statusChangedSince(
	read: Pick<WeekRead, 'writtenAt' | 'status'>,
	capture: Pick<Designations, 'readAt' | 'checkedAt'>,
	listed: PlayerStatus | undefined
): boolean {
	const written = Date.parse(read.writtenAt);
	if (lastRead(capture) <= written) return false;
	if (read.status !== (listed?.status ?? null)) return true;
	return listed?.since != null && Date.parse(listed.since) > written;
}
