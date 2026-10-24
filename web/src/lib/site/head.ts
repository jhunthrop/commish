/** Every page's head for search engines, assistants and link unfurls (Lane 169): its title, its one
 * description sentence, its canonical address, the share tags and its structured data. The server
 * builds the head's markup with the page (headMarkup) and the page's script carries only that string
 * and its title (HeadTags.svelte); the Worker's pages take the whole head as markup (headHtml, put in
 * by hooks.server.ts for the pages the browser draws). Pure, so the tests read what every page prints. */
import { APP_NAME } from './app-manifest.ts';
import { SITE_ORIGIN } from './origins.ts';
import type { StructuredData } from './structured-data.ts';

/** The site's name in every title and the share tags. */
export const SITE_NAME = APP_NAME;
/** Between the page's name and the site's in the document's title. */
const TITLE_JOIN = ' · ';

/** The share cards, one static file per page family (scripts/share-cards.ts draws them): the mark
 * and the family's name at the size every unfurl takes. */
export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;
export const SHARE_CARDS = {
	site: {
		path: '/share/site.png',
		name: 'Fantasy football rankings and draft prep',
		alt: 'Commish, fantasy football rankings and draft prep'
	},
	player: {
		path: '/share/player.png',
		name: 'Player pages',
		alt: 'Commish player page'
	}
} as const;
export type ShareCard = keyof typeof SHARE_CARDS;

/** What a page's head says of it, built with the page. */
export interface PageMeta {
	/** The page's one sentence: what it is, from its own facts. */
	description: string;
	/** Its canonical address on the site, a path with no query string; null on a page served at any
	 * address (the not-found page), which names none. */
	path: string | null;
	/** A player's page is a profile, every other page a website. */
	type: 'website' | 'profile';
	card: ShareCard;
	/** The page's schema.org data, null where it has none. */
	structured: StructuredData | null;
	/** A member's own page or a page with nothing public: kept out of search. */
	noindex: boolean;
}

/** The whole head: the page's name and what the page builds. */
export interface PageHead extends PageMeta {
	title: string;
}

/** Everything in a page's head but its title and og:title, as markup built with the page on the
 * server (headMarkup). */
export type HeadMarkup = string;

/** What the shell prints in a page's head: its name, and the markup built with it. */
export interface ShellHead {
	title: string;
	markup: HeadMarkup;
}

/** A page's meta with the defaults said once: a website, the site's card, no data, indexed. */
export function pageMeta(
	description: string,
	path: string | null,
	more: Partial<Omit<PageMeta, 'description' | 'path'>> = {}
): PageMeta {
	return {
		description,
		path,
		type: more.type ?? 'website',
		card: more.card ?? 'site',
		structured: more.structured ?? null,
		noindex: more.noindex ?? false
	};
}

/** "Puka Nacua · Commish". */
export function documentTitle(name: string): string {
	return `${name}${TITLE_JOIN}${SITE_NAME}`;
}

/** An address on the apex, with no query string or fragment. */
export function siteUrl(path: string): string {
	const bare = path.split(/[?#]/)[0] ?? '';
	if (!bare.startsWith('/')) throw new Error(`${path} is not a path on the site.`);
	return `${SITE_ORIGIN}${bare}`;
}

/** One share tag: Open Graph's by property, the card's by name. */
export interface ShareTag {
	key: 'property' | 'name';
	id: string;
	content: string;
}

/** The share tags after og:title, which a page prints with its title, in the order it prints them. */
export function shareTags(meta: PageMeta): ShareTag[] {
	const card = SHARE_CARDS[meta.card];
	const og = (id: string, content: string): ShareTag => ({ key: 'property', id, content });
	return [
		og('og:description', meta.description),
		...(meta.path === null ? [] : [og('og:url', siteUrl(meta.path))]),
		og('og:site_name', SITE_NAME),
		og('og:type', meta.type),
		og('og:image', siteUrl(card.path)),
		og('og:image:width', String(SHARE_CARD_SIZE.width)),
		og('og:image:height', String(SHARE_CARD_SIZE.height)),
		og('og:image:alt', card.alt),
		{ key: 'name', id: 'twitter:card', content: 'summary_large_image' }
	];
}

/** The structured data as a script element's markup: a "<" in a value never closes it early. */
export function structuredScript(data: StructuredData): string {
	const json = JSON.stringify(data).replace(/</g, '\\u003c');
	return `<script type="application/ld+json">${json}</script>`;
}

const ESCAPES: Readonly<Record<string, string>> = {
	'&': '&amp;',
	'"': '&quot;',
	'<': '&lt;',
	'>': '&gt;'
};
const escaped = (text: string): string => text.replace(/[&"<>]/g, (mark) => ESCAPES[mark] ?? mark);

/** The head but its title and og:title: the description, the robots line, the canonical address,
 * the share tags and the structured data. */
export function headMarkup(meta: PageMeta): HeadMarkup {
	return [
		`<meta name="description" content="${escaped(meta.description)}">`,
		...(meta.noindex ? ['<meta name="robots" content="noindex">'] : []),
		...(meta.path === null ? [] : [`<link rel="canonical" href="${escaped(siteUrl(meta.path))}">`]),
		...shareTags(meta).map(
			(tag) => `<meta ${tag.key}="${tag.id}" content="${escaped(tag.content)}">`
		),
		...(meta.structured === null ? [] : [structuredScript(meta.structured)])
	].join('');
}

/** The whole head as markup, for a page the browser draws, whose head the Worker answers before any
 * script runs (hooks.server.ts): the tags the component prints, in the same order. */
export function headHtml(head: PageHead): string {
	return [
		`<title>${escaped(documentTitle(head.title))}</title>`,
		`<meta property="og:title" content="${escaped(head.title)}">`,
		headMarkup(head)
	].join('');
}
