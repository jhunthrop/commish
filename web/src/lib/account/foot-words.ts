/** The account page's own foot (Lane 151): the two legal pages under the Delete account verb
 * (delete-words.ts, Lane 233). Kept apart from the site footer's words so the shell's chunk never
 * carries it. The apps print the same foot (shared/words/account-foot.json, Lane 237). */
export const ACCOUNT_FOOT = {
	label: 'Your data',
	privacy: 'Privacy Policy',
	joint: ' and the ',
	terms: 'Terms of Service',
	end: '.'
} as const;
