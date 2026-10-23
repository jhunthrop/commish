/** The site footer's words (Lane 151): who runs the site and the two legal pages, the contact beside
 * them (contact.ts). The shell's footer writes them as markup to keep them out of every page's
 * script, and site-footer.test.ts holds that markup to this table word for word. */
export const FOOT = {
	owner: 'Commish LLC',
	terms: 'Terms',
	privacy: 'Privacy'
} as const;
