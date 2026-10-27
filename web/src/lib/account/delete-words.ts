/** The delete account page's words (Lane 233, B230): what goes, what stays, the typed confirmation,
 * the one verb, and the page after. The stores cite the page's address (docs/store), so its states
 * all live at /account/delete. */

/** The name a kept lobby seat carries once its member is gone: the API's deletion.DepartedHandle,
 * held to it by delete-words.test.ts. */
export const DEPARTED_NAME = 'Former member';

/** The query the page carries once the account is deleted, so a reload still says so. */
export const DELETED_PARAM = 'deleted';

export const DELETE_WORDS = {
	title: 'Delete account',
	heading: 'Delete your account',
	lead: 'Your account and everything kept with it go for good. This cannot be undone.',
	deletedHead: 'Deleted',
	deleted: [
		'Your sign-in, email, name and handle',
		'Your cheat sheets and their exports',
		'Your mock drafts and their reports',
		'The leagues you follow and your platform connections',
		'Every browser and phone paired with your account',
		'Your passes and your membership'
	],
	keptHead: 'Kept',
	kept: [
		`Your seats and picks in lobby drafts, under the name ${DEPARTED_NAME}`,
		'A group pass you bought, for the people who claimed it'
	],
	signedInAs: 'Signed in as',
	confirm: 'Type your email to confirm',
	verb: 'Delete account',
	/** The apps' confirmation sheet's one verb (Lane 237): their Account screen's foot already says
	 * Delete account, and opens the sheet. */
	sheetVerb: 'Delete my account',
	failed: 'Your account was not deleted. Try again.',
	doneTitle: 'Your account is deleted',
	doneLine: 'Everything kept with it is gone, and you are signed out on every device.',
	home: 'Back to Commish',
	signedOutTitle: 'Sign in to delete your account',
	signedOutLine: 'Sign in with the account to delete, and you come back to this page.',
	signIn: 'Sign in',
	offlineTitle: "You're offline",
	offlineLine: 'This page loads your account as soon as you are back online.',
	unreachableTitle: "Your account can't be reached right now",
	unreachableLine: 'Nothing was deleted.',
	tryAgain: 'Try again'
} as const;

/** The account room's foot (Lane 233): the verb that opens this page, then the legal pages. The
 * apps' Account screens print the same foot, their verb opening the confirmation sheet (Lane 237). */
export const ACCOUNT_DELETE_FOOT = {
	verb: 'Delete account',
	keep: 'What we keep is in the '
} as const;
