/** Where each place a legal page links to lives (legal-doc.ts LegalTarget), built on the server with
 * the page's words: the pages are prerendered from their load, so neither the words nor the data
 * licence's module ride in a browser's script, and the player page keeps the credit's chunk to
 * itself (Lane 151, the script budget). */
import { CREDIT_LICENCE_HREF } from '#lib/site/credit.ts';
import { SUPPORT_HREF } from './contact.ts';
import type { LegalTarget } from './legal-doc.ts';
import { legalLinks } from './legal-links.ts';

export type LegalHrefs = Readonly<Record<LegalTarget, string>>;

export function legalHrefs(): LegalHrefs {
	return {
		support: SUPPORT_HREF,
		terms: legalLinks.terms(),
		privacy: legalLinks.privacy(),
		licence: CREDIT_LICENCE_HREF
	};
}
