/** What the player card's week is read over (Lane 113): his page's build, in the format the card
 * leads with. One source for the player page and the player shelf, so the shelf shows the top of the
 * page as the page draws it. The shelf reads it from the prerendered /data/cards/<slug>.json, the
 * page's own build cut to the card's top (cardData), so a phone fetches none of the page's game log or
 * script. */
import type { FormatLine, PlayerPage } from '#lib/server/pages/player.ts';
import type { CardTile } from './card.ts';
import type { CardPlayer, LiveInput, TierAsk } from './week-words.ts';

/** A format's line as the card's top reads it: the figures the card leads with, the context's
 * format's when the run carries it, else the page's own (context-format.ts contextLine). */
export type CardLead = Pick<
	FormatLine,
	'format' | 'numbers' | 'restTile' | 'restParts' | 'basisTiles'
>;

/** The top of his page: who he is, his designation, the card's build, the week read and the week's
 * last kickoffs, with each format's line the card can lead with. */
export type CardData = Pick<
	PlayerPage,
	| 'id'
	| 'slug'
	| 'name'
	| 'position'
	| 'team'
	| 'headshot'
	| 'clubName'
	| 'status'
	| 'card'
	| 'weekRead'
	| 'weekReadsDue'
	| 'lastKickoffs'
> &
	CardLead & { lines: CardLead[] };

/** The card's build the week's read words over: everything liveCard takes but the read itself, the
 * league, the links and the clock. */
export type CardSource = Omit<LiveInput, 'week' | 'league' | 'screenHref' | 'zone' | 'now'>;

function leadOf(line: CardLead): CardLead {
	const { format, numbers, restTile, restParts, basisTiles } = line;
	return { format, numbers, restTile, restParts, basisTiles };
}

/** His page's build cut to the card's top, as /data/cards/<slug>.json serves it. */
export function cardData(page: PlayerPage): CardData {
	const {
		id,
		slug,
		name,
		position,
		team,
		headshot,
		clubName,
		status,
		card,
		weekRead,
		weekReadsDue
	} = page;
	return {
		id,
		slug,
		name,
		position,
		team,
		headshot,
		clubName,
		status,
		card,
		weekRead,
		weekReadsDue,
		lastKickoffs: page.lastKickoffs,
		...leadOf(page),
		lines: page.lines.map(leadOf)
	};
}

/** The tiles as built: rest of season in the lead's format beside the week's, "--" until read. */
export function builtTiles(
	page: Pick<CardData, 'card'>,
	lead: Pick<CardLead, 'restTile'>
): CardTile[] {
	return page.card.tiles.flatMap((tile) => (tile.key === 'opp' ? [lead.restTile, tile] : [tile]));
}

/** The player the card reads, as his page names him. */
export function cardPlayer(page: Pick<CardData, 'id' | 'name' | 'team' | 'position'>): CardPlayer {
	return { id: page.id, name: page.name, team: page.team, position: page.position };
}

/** The card's build from his page, with the tier box the read is asked for (null on the shelf, which
 * draws no tier box). */
export function cardSource(
	page: Pick<
		CardData,
		'id' | 'name' | 'team' | 'position' | 'card' | 'lastKickoffs' | 'status' | 'weekRead'
	>,
	lead: CardLead,
	tier: TierAsk | null
): CardSource {
	return {
		player: cardPlayer(page),
		tiles: builtTiles(page, lead),
		opponents: page.card.opponents,
		games: page.card.games,
		rest: lead.restParts,
		tier,
		basisTiles: lead.basisTiles,
		lastKickoffs: page.lastKickoffs,
		// The list his page's pill shows (the run's injury capture), "IR" in place of his week.
		held: page.status?.words.view.rank ?? null,
		read: page.weekRead
	};
}
