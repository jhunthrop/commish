/** What a crawler reads besides the pages (Lane 169, rulings 4 and 5): the sitemap of every public
 * page, the robots file that names it and keeps the member's own pages out, and /llms.txt, the
 * plain-text page an assistant reads to learn what the site is. Pure, so the tests read them. */
import { SITE_NAME, siteUrl } from './head.ts';

/** The pages the browser draws for a member and the account: nothing public, so not crawled. Every
 * other path, and every crawler (the assistants' among them), is allowed. */
export const UNCRAWLED_PATHS = [
	'/account',
	'/league/',
	'/mock/',
	'/lobby/',
	'/companion/',
	'/claim'
] as const;

export const SITEMAP_PATH = '/sitemap.xml';
export const LLMS_PATH = '/llms.txt';

const XML_ESCAPES: Readonly<Record<string, string>> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&apos;'
};
const xmlEscaped = (text: string): string =>
	text.replace(/[&<>"']/g, (mark) => XML_ESCAPES[mark] ?? mark);

/** The sitemap: each path once, on the apex, every one last changed with the run. */
export function sitemapXml(paths: readonly string[], lastmod: string): string {
	const urls = [...new Set(paths)].map(
		(path) =>
			`<url><loc>${xmlEscaped(siteUrl(path))}</loc><lastmod>${xmlEscaped(lastmod)}</lastmod></url>`
	);
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...urls,
		'</urlset>',
		''
	].join('\n');
}

/** The robots file: one group for every crawler, the member's pages kept out, the sitemap named. */
export function robotsTxt(): string {
	return [
		'# Every public page may be crawled by every crawler, the assistants included. The account and',
		'# the pages the browser draws for a member carry nothing public.',
		'User-agent: *',
		...UNCRAWLED_PATHS.map((path) => `Disallow: ${path}`),
		'Allow: /',
		'',
		`Sitemap: ${siteUrl(SITEMAP_PATH)}`,
		''
	].join('\n');
}

/** One public page in /llms.txt: its name, its address and one line of what it holds. */
export interface LlmsPage {
	name: string;
	path: string;
	line: string;
}

/** The site in one paragraph, the opening of /llms.txt. */
export const LLMS_ABOUT =
	"Commish is a fantasy football site. It publishes its own rest-of-season rankings for every QB, RB, WR and TE, a page for every player, and a public record of how its rankings called each week's games. Members follow their own leagues for their lineup, matchup, waivers and trades, run mock drafts and keep a cheat sheet.";

/** /llms.txt in the plain-text convention (llmstxt.org): the name, the paragraph, the pages. */
export function llmsTxt(pages: readonly LlmsPage[]): string {
	return [
		`# ${SITE_NAME}`,
		'',
		`> ${LLMS_ABOUT}`,
		'',
		'## Public pages',
		'',
		...pages.map((page) => `- [${page.name}](${siteUrl(page.path)}): ${page.line}`),
		''
	].join('\n');
}
