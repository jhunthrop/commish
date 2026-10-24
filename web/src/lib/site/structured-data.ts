/** The schema.org data the prerendered pages carry as JSON-LD (Lane 169, ruling 3): a player page's
 * Person, the rankings page's ItemList, the record's Dataset and the front door's Organization. The
 * builders take facts the page already has; `structuredFaults` holds each to the fields schema.org
 * and the search engines' rich results name as required, read by the tests on every built page. */
import { SUPPORT_EMAIL } from '#lib/legal/contact.ts';
import { SITE_NAME, siteUrl } from './head.ts';

const CONTEXT = 'https://schema.org';
/** The company behind the site, the Organization's legal name. */
export const COMPANY_NAME = 'Commish LLC';
/** The ItemList's length on the rankings page. */
export const RANKINGS_LIST_SIZE = 50;
/** A Dataset's description is 50 to 5000 characters long (Google's Dataset rich result). */
const DATASET_DESCRIPTION = { min: 50, max: 5000 } as const;

export interface SportsTeamData {
	'@type': 'SportsTeam';
	name: string;
}

export interface PersonData {
	'@context': typeof CONTEXT;
	'@type': 'Person';
	name: string;
	jobTitle: string;
	url: string;
	image?: string;
	memberOf?: SportsTeamData;
}

export interface ListItemData {
	'@type': 'ListItem';
	position: number;
	url: string;
	name: string;
}

export interface ItemListData {
	'@context': typeof CONTEXT;
	'@type': 'ItemList';
	name: string;
	numberOfItems: number;
	itemListElement: ListItemData[];
}

export interface DatasetData {
	'@context': typeof CONTEXT;
	'@type': 'Dataset';
	name: string;
	description: string;
	temporalCoverage: string;
	url: string;
	creator: { '@type': 'Organization'; name: string; url: string };
}

export interface OrganizationData {
	'@context': typeof CONTEXT;
	'@type': 'Organization';
	name: string;
	alternateName: string;
	url: string;
	contactPoint: { '@type': 'ContactPoint'; contactType: string; email: string };
}

export type StructuredData = PersonData | ItemListData | DatasetData | OrganizationData;

/** A player's page: his name, "WR, Los Angeles Rams", his face, his club. A free agent has no club. */
export function personData(player: {
	name: string;
	position: string;
	club: string | null;
	path: string;
	image: string | null;
}): PersonData {
	return {
		'@context': CONTEXT,
		'@type': 'Person',
		name: player.name,
		jobTitle: player.club === null ? player.position : `${player.position}, ${player.club}`,
		url: siteUrl(player.path),
		...(player.image === null ? {} : { image: player.image }),
		...(player.club === null
			? {}
			: { memberOf: { '@type': 'SportsTeam' as const, name: player.club } })
	};
}

/** The rankings page's order, its first RANKINGS_LIST_SIZE ranked players, each at the overall rank
 * the page prints beside him (fix round 1, M2). A player on a season-long list shows a word there,
 * never a number, so the caller leaves him out and the ranks after him keep the page's numbers. */
export function itemListData(
	name: string,
	players: readonly { name: string; path: string; rank: number }[]
): ItemListData {
	const shown = players.slice(0, RANKINGS_LIST_SIZE);
	return {
		'@context': CONTEXT,
		'@type': 'ItemList',
		name,
		numberOfItems: shown.length,
		itemListElement: shown.map((player) => ({
			'@type': 'ListItem',
			position: player.rank,
			url: siteUrl(player.path),
			name: player.name
		}))
	};
}

/** The record: what it grades, over the season's dates it covers ("2026-09-10/2026-10-12"). */
export function datasetData(record: {
	name: string;
	description: string;
	from: string;
	through: string;
	path: string;
}): DatasetData {
	return {
		'@context': CONTEXT,
		'@type': 'Dataset',
		name: record.name,
		description: record.description,
		temporalCoverage: `${record.from}/${record.through}`,
		url: siteUrl(record.path),
		creator: { '@type': 'Organization', name: COMPANY_NAME, url: siteUrl('/') }
	};
}

/** The front door: the company, its address and where a member writes. The site has no search
 * address a crawler could fill in (its search runs in the page), so no WebSite SearchAction. */
export function organizationData(): OrganizationData {
	return {
		'@context': CONTEXT,
		'@type': 'Organization',
		name: COMPANY_NAME,
		alternateName: SITE_NAME,
		url: siteUrl('/'),
		contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: SUPPORT_EMAIL }
	};
}

const filled = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';
const isUrl = (value: unknown): boolean =>
	typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value);
const isIsoDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

function personFaults(data: PersonData): string[] {
	// Read as parsed JSON: the built page's data may not hold to the type.
	const team: { '@type': string; name: string } | undefined = data.memberOf;
	return [
		...(filled(data.name) ? [] : ['Person has no name']),
		...(filled(data.jobTitle) ? [] : ['Person has no jobTitle']),
		...(isUrl(data.url) ? [] : ['Person has no url']),
		...(data.image === undefined || isUrl(data.image) ? [] : ['Person image is not a URL']),
		...(team === undefined || (team['@type'] === 'SportsTeam' && filled(team.name))
			? []
			: ['Person memberOf is not a named SportsTeam'])
	];
}

function itemListFaults(data: ItemListData): string[] {
	const items = data.itemListElement;
	return [
		...(items.length > 0 ? [] : ['ItemList has no itemListElement']),
		...(data.numberOfItems === items.length ? [] : ['ItemList numberOfItems is not its length']),
		...items.flatMap((item: { '@type': string; position: number; url: string }, at) =>
			item['@type'] === 'ListItem' &&
			Number.isInteger(item.position) &&
			item.position > (items[at - 1]?.position ?? 0) &&
			isUrl(item.url)
				? []
				: [`ItemList item ${String(at + 1)} lacks a rising position or its url`]
		)
	];
}

function datasetFaults(data: DatasetData): string[] {
	const [from = '', through = ''] = data.temporalCoverage.split('/');
	const length = data.description.length;
	return [
		...(filled(data.name) ? [] : ['Dataset has no name']),
		...(length >= DATASET_DESCRIPTION.min && length <= DATASET_DESCRIPTION.max
			? []
			: [`Dataset description is ${String(length)} characters`]),
		...(isIsoDay(from) && isIsoDay(through) && from <= through
			? []
			: ['Dataset temporalCoverage is not a day interval']),
		...(isUrl(data.url) ? [] : ['Dataset has no url'])
	];
}

function organizationFaults(data: OrganizationData): string[] {
	return [
		...(filled(data.name) ? [] : ['Organization has no name']),
		...(isUrl(data.url) ? [] : ['Organization has no url']),
		...(filled(data.contactPoint.contactType) && /^[^@\s]+@[^@\s]+$/.test(data.contactPoint.email)
			? []
			: ['Organization contactPoint has no contactType or email'])
	];
}

/** What a page's data lacks of its type's required fields; empty when it is whole. */
export function structuredFaults(data: StructuredData): string[] {
	const named: string = data['@context'];
	const context = named === CONTEXT ? [] : ['the data names no schema.org context'];
	switch (data['@type']) {
		case 'Person':
			return [...context, ...personFaults(data)];
		case 'ItemList':
			return [...context, ...itemListFaults(data)];
		case 'Dataset':
			return [...context, ...datasetFaults(data)];
		case 'Organization':
			return [...context, ...organizationFaults(data)];
	}
}
