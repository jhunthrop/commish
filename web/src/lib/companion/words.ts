/** The live-draft companion's words (Lane 210): the followed draft's page, its bar, the shortlist and
 * the start page, in one table so the apps print the same words (shared/scripts/gen-words.ts). A
 * sentence that names the platform or a pick is built in model.ts from these. */
export const COMPANION = {
	title: 'Live draft',
	followAnother: 'Follow another draft',
	/** The draft's name when the platform gives none. */
	yourDraft: 'Your draft',
	reconnecting: 'Reconnecting. The picks below are the last ones we read.',
	signedOutTitle: 'Sign in to follow your draft',
	signedOutLine: 'A followed draft lives on your account.',
	signIn: 'Sign in',
	missingTitle: 'This draft is not on your account',
	missingLine: 'Paste the draft link again to follow it.',
	followADraft: 'Follow a draft',
	unreachableTitle: "Your draft can't be read right now",
	reloadLine: 'Reload in a moment.',
	/** The strip's second line under the newest pick. */
	newestFirst: 'newest first',
	/** Who made a pick on the strip, when the drafter did. */
	you: 'you',
	nextTitle: 'Who we would take next',
	nextAside: 'Chance he lasts',
	/** The pool's chance column, on a call that waits on the board and on the drafter's own. */
	reachesHead: 'Reaches',
	stillThereHead: 'Still there',
	/** The report's runs: who stands in for the other seats of a league on another platform. */
	reshuffled: 'stand-ins for your league'
} as const;

/** The start page's words: the form that follows a draft, and the drafts followed before. */
export const COMPANION_NEW = {
	title: 'Follow your draft',
	lede: 'At each of your picks you get our call, against the picks your league actually makes.',
	/** The link field's words for a development replay (COMPANION_REPLAY on the API), which always
	 * follows the recorded draft. */
	replay: 'The recorded draft (development replay)',
	draftOn: 'Your draft is on',
	linkLabel: 'Your Sleeper draft link',
	linkPlaceholder: 'sleeper.com/draft/nfl/1234567890',
	seatBy: 'Find your seat by',
	bySlot: 'My draft slot',
	byUsername: 'My Sleeper username',
	slotLabel: 'Your draft slot',
	usernameLabel: 'Sleeper username',
	verb: 'Follow my draft',
	failed: 'That did not go through. Try again.',
	recentFailed: "The drafts you followed can't be read right now.",
	recentTitle: 'Drafts you followed',
	unreachableTitle: "This page can't reach Commish right now",
	reloadLine: 'Reload in a moment.'
} as const;
