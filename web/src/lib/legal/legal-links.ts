/** The two legal pages' addresses, built once with resolve(): the legal pages and the account foot
 * link them from here. The site footer's own markup holds the same two paths as written, held to
 * these routes by site-footer.test.ts, so the shell's chunk carries no code for them (Lane 151). */
import { resolve } from '$app/paths';

export const legalLinks = {
	terms: (): string => resolve('/terms'),
	privacy: (): string => resolve('/privacy')
} as const;
