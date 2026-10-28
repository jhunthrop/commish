/** The words over a week read his designation moved past (Lane 162, D01; Lane 274): one source for the
 * web and both apps (shared/words/player-status-held.json), and the run's own (`capsules/week/caption.py
 * status_changed_caption`, held to these by research/tests/test_status_words_drift.py). Kept apart from
 * status-held.ts so the shelf's script carries the words and none of the build rule. */

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
