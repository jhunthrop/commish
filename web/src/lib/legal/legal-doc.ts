/** A legal page's shape (Lane 151): its title, the draft note, the day it last changed, a lead and
 * its sections, each a head and paragraphs. A paragraph is parts: plain words, or words that link to
 * a named place (the contact address, the other page, the data licence), which the page resolves, so
 * the words stay free of the router. The words live in terms-words.ts and privacy-words.ts. */
export type LegalTarget = 'support' | 'terms' | 'privacy' | 'licence' | 'deleteAccount';

export interface LegalLink {
	readonly text: string;
	readonly to: LegalTarget;
}

export type LegalPart = string | LegalLink;

export type LegalParagraph = readonly LegalPart[];

export interface LegalSection {
	readonly head: string;
	readonly paragraphs: readonly LegalParagraph[];
}

export interface LegalDoc {
	/** The document's title and the bar's. */
	readonly title: string;
	/** The one-line note at the top while counsel reviews the words; a later lane removes it. */
	readonly draftNote: string;
	/** "Last changed October 22, 2026." */
	readonly changed: string;
	readonly lead: string;
	readonly sections: readonly LegalSection[];
}

/** The day both pages last changed, said at the top of each. */
export const LEGAL_CHANGED = 'Last changed October 26, 2026.';

/** The note at the top of each page while counsel reviews it. */
export const DRAFT_NOTE = 'Draft for review.';

/** A section's anchor, from its head: "Deleting your account" is #deleting-your-account. The stores
 * cite the anchors (docs/store), so a head that changes moves its address (Lane 233). */
export function sectionId(head: string): string {
	return head
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/** The Privacy Policy's section the stores cite for deleting an account. */
export const DELETING_HEAD = 'Deleting your account';

/** A paragraph's words as a reader hears them, a link read as its words. */
export function paragraphText(paragraph: LegalParagraph): string {
	return paragraph.map((part) => (typeof part === 'string' ? part : part.text)).join('');
}

/** Every sentence a page prints, for the copy guard. */
export function docText(doc: LegalDoc): string[] {
	return [
		doc.title,
		doc.draftNote,
		doc.changed,
		doc.lead,
		...doc.sections.flatMap((section) => [section.head, ...section.paragraphs.map(paragraphText)])
	];
}
