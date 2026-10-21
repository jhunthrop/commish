/** The player shelf (Lane 113): a tap on a player's row opens the top of his page over the screen
 * the member is deciding on, a bottom sheet on a phone and a side shelf at a desk, with one verb for
 * that screen. Pure, so the tests read what the shelf prints: the row's own cells drawn as the card's
 * tiles at once, his Pts in place of Proj once his game has kicked off (the screen's one game-state
 * rule, kickoff.ts lineState as the row carries it), and the verb by the screen and his game. */
import { BOX, deltaWord, easeOf, oppRankWord, type BoxRow } from '#lib/league/box/box.ts';
import { CARD, NONE, printTenth, TILE_ORDER, type CardTile, type TileKey } from './card.ts';
import type { ScreenOffer, ShelfScreen } from './shelf-state.ts';
import type { NextCell } from './week-words.ts';

/** The shelf's own words, in one place for the copy guard. */
export const SHELF = {
	/** The link to his page, at the top right. */
	fullPage: 'Full page',
	close: 'Close'
} as const;

/** The screens whose verb is the member's lineup. */
const LINEUP_SCREENS: ReadonlySet<ShelfScreen> = new Set(['lineup', 'matchup', 'league']);

/** The shelf's verb: its words, the line under it and where it goes or what it does on the screen;
 * or once his game has kicked off on a lineup screen the held row's words in its place (no lineup
 * move takes him then). */
export type ShelfVerb =
	| {
			kind: 'act';
			label: string;
			line: string | null;
			href: string | null;
			run: (() => void) | null;
			focus: string | null;
	  }
	| { kind: 'held'; words: string };

/** The verb the shelf gives him on the screen it opened from, at that screen's clock: none where the
 * screen offers none (an opponent's player on the Matchup, a Rest of season row with no move). */
export function shelfVerb(
	screen: ShelfScreen,
	state: BoxRow['state'],
	offer: ScreenOffer | null
): ShelfVerb | null {
	if (offer === null) return null;
	if (LINEUP_SCREENS.has(screen)) {
		if (state === 'final') return { kind: 'held', words: CARD.gameFinal };
		if (state === 'kicked_off') return { kind: 'held', words: CARD.kickedOff };
	}
	const { line, href, run, focus } = offer;
	const label = 'label' in offer ? offer.label : CARD[offer.card];
	return { kind: 'act', label, line, href, run, focus };
}

/** The tiles before his page's build is read: the card's six in its order, each "--". */
const BLANK_LABELS: Readonly<Record<TileKey, string>> = {
	proj: CARD.proj,
	rest: CARD.rest,
	opp: CARD.opp,
	avg: CARD.avg,
	last: CARD.last,
	delta: CARD.delta
};

function blankTiles(): CardTile[] {
	return TILE_ORDER.map((key) => ({
		key,
		label: BLANK_LABELS[key],
		value: NONE,
		caption: '',
		tone: key === 'proj' ? 'lead' : key === 'delta' ? 'quiet' : null
	}));
}

/** A figure the row holds over the tile's, the tile kept where the row has none. */
function over(tile: CardTile, value: number | null, print: (v: number) => string): CardTile {
	return value === null ? tile : { ...tile, value: print(value) };
}

/** The row's own cells drawn as the card's tiles over his page's tiles as built (the blank six until
 * they are read): Proj, Opp rank with its ease while his game is to come, Avg, Last and Δ Proj are the
 * screen's figures, so the shelf opens on what the row showed. */
export function rowTiles(row: BoxRow, built: readonly CardTile[] | null): CardTile[] {
	const { evidence } = row;
	const rank = evidence.oppRank;
	return (built ?? blankTiles()).map((tile) => {
		switch (tile.key) {
			case 'proj':
				return over(tile, row.proj, printTenth);
			case 'opp':
				return rank === null
					? tile
					: {
							...tile,
							value: oppRankWord(rank),
							tone: row.toCome ? easeOf(rank, evidence.oppOf) : 'even'
						};
			case 'avg':
				return over(tile, evidence.avg, printTenth);
			case 'last':
				return over(tile, evidence.last, printTenth);
			case 'delta':
				return evidence.delta === null ? tile : { ...tile, value: deltaWord(evidence.delta) };
			case 'rest':
				return tile;
		}
	});
}

/** The week tile by the screen's game-state rule: Proj while his game is to come, his Pts once it has
 * kicked off, as the row's own Pts cell. */
export function gameTiles(
	tiles: readonly CardTile[],
	state: BoxRow['state'],
	pts: number | null
): CardTile[] {
	if (state !== 'kicked_off' && state !== 'final') return [...tiles];
	return tiles.map((tile) =>
		tile.key === 'proj'
			? {
					...tile,
					label: BOX.pts,
					value: pts === null ? NONE : printTenth(pts),
					caption: state === 'final' ? CARD.gameFinal : CARD.kickedOff
				}
			: tile
	);
}

/** His game as the row's Game cell says it, the shelf's line under his name until the week is read:
 * null on a bye or without a game held. */
export function rowNext(row: Pick<BoxRow, 'game' | 'expected' | 'weather'>): NextCell | null {
	if (row.game === null || row.game === 'bye') return null;
	return {
		where: row.game.where,
		when: row.game.when,
		expected: row.expected,
		weather: row.weather
	};
}
