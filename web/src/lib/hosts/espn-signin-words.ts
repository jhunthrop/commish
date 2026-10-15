/** What the account page says when Disney's sign-in for ESPN hands nothing over (espn-oneid.ts):
 * one sentence for each way it can end, and a plain account of the widget events the window saw,
 * so the next report names the branch. */
import type { DisneyOutcome } from './espn-oneid.ts';
import type { WidgetEvent } from './espn-window.ts';

const PASTE = 'Paste the two values below instead.';

/** What Disney did, event by event, in the words the account page uses. */
const EVENT_WORDS: Readonly<Record<WidgetEvent, string>> = {
	'init-signed-in': 'said you were already signed in',
	'init-signed-out': 'said you were signed out',
	login: 'saw you sign in',
	logout: 'signed you out',
	error: 'reported a problem'
};

/** The sentence for how the sign-in ended, null when there is nothing to say: a session handed
 * over, or the member closing the window with its own button. */
export function problemOf(outcome: DisneyOutcome): string | null {
	switch (outcome.kind) {
		case 'session':
		case 'closed':
			return null;
		case 'no-session':
			return `ESPN signed you in but did not hand us your session. ${PASTE}`;
		case 'nothing':
			return `The ESPN window closed without handing anything back. ${PASTE}`;
		case 'error':
			return `Disney's sign-in stopped with "${outcome.reason}". ${PASTE}`;
		case 'failed':
			return `ESPN's sign-in did not open here. ${PASTE}`;
	}
}

/** What Disney did, in one sentence: "Disney said you were already signed in and handed nothing
 * back." */
export function seenWords(seen: readonly WidgetEvent[]): string {
	if (seen.length === 0) return "Disney's sign-in never answered the window.";
	return `Disney ${seen.map((event) => EVENT_WORDS[event]).join(', then ')} and handed nothing back.`;
}
