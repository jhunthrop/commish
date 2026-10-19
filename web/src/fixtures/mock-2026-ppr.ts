/**
 * The mock's real 2026 data, and the only fixture in this app.
 *
 * Rows copied verbatim from docs/design/mocks/2026-10-12-commish/data/board-ppr.csv, the 2026 PPR
 * board the approved mocks were built from. The derived values (our rank and its round, the WR
 * tier 3 cliff, the range scale of the WR top 40, the solo room at pick 5.08 with seed 2026) were
 * computed by the mock's own build (build/data.py, mock.py, mocksim.py, survival.py) over the full
 * 400-row board, so the system page prints the same numbers as system.html.
 *
 * It exists for the system page only. Every product page reads a nightly run.
 */
import { POSITIONS, type BoardPlayer, type Position } from '#lib/types/player.ts';
import type { TeamSlot, WentPick } from '#lib/types/room.ts';
import type { TierCliff } from '#lib/ui/tier.ts';

/** The board CSV's header, column for column. */
type BoardCsvColumn =
	| 'rank'
	| 'position_rank'
	| 'name'
	| 'position'
	| 'nfl_team'
	| 'adp'
	| 'pos_adp'
	| 'headshot_url'
	| 'projected_points'
	| 'value_over_replacement'
	| 'expected_games'
	| 'floor_points'
	| 'median_points'
	| 'ceiling_points'
	| 'tier'
	| 'player_id'
	| 'gsis';
type BoardCsvRow = Record<BoardCsvColumn, string>;

const ROWS: readonly BoardCsvRow[] = [
	{
		rank: '6',
		position_rank: '4',
		name: 'Amon-Ra St. Brown',
		position: 'WR',
		nfl_team: 'DET',
		adp: '5.4',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4374302.png',
		projected_points: '295.25',
		value_over_replacement: '115.22',
		expected_games: '15.381700561301479',
		floor_points: '217.21205859595088',
		median_points: '295.32865077698835',
		ceiling_points: '373.4452429580258',
		tier: '1',
		player_id: '4374302',
		gsis: '00-0036963'
	},
	{
		rank: '10',
		position_rank: '5',
		name: 'Dak Prescott',
		position: 'QB',
		nfl_team: 'DAL',
		adp: '77.5',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/2577417.png',
		projected_points: '274.32',
		value_over_replacement: '22.150000000000006',
		expected_games: '14.011232835406707',
		floor_points: '173.01955322820135',
		median_points: '274.3399389172633',
		ceiling_points: '375.6603246063252',
		tier: '1',
		player_id: '2577417',
		gsis: '00-0033077'
	},
	{
		rank: '11',
		position_rank: '6',
		name: 'Chris Olave',
		position: 'WR',
		nfl_team: 'NO',
		adp: '18.1',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4361370.png',
		projected_points: '273.73',
		value_over_replacement: '93.70000000000002',
		expected_games: '14.599935498220827',
		floor_points: '185.2242742213374',
		median_points: '273.7487905916405',
		ceiling_points: '362.2733069619436',
		tier: '2',
		player_id: '4361370',
		gsis: '00-0037239'
	},
	{
		rank: '14',
		position_rank: '6',
		name: 'Jalen Hurts',
		position: 'QB',
		nfl_team: 'PHI',
		adp: '57.3',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4040715.png',
		projected_points: '270.41',
		value_over_replacement: '18.240000000000038',
		expected_games: '15.095337215663363',
		floor_points: '189.81981140282252',
		median_points: '270.35748953253085',
		ceiling_points: '350.89516766223915',
		tier: '1',
		player_id: '4040715',
		gsis: '00-0036389'
	},
	{
		rank: '30',
		position_rank: '3',
		name: "De'Von Achane",
		position: 'RB',
		nfl_team: 'MIA',
		adp: '21.2',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4429160.png',
		projected_points: '245.43',
		value_over_replacement: '97.27000000000001',
		expected_games: '14.312093543195827',
		floor_points: '160.94972440489198',
		median_points: '245.4524042658084',
		ceiling_points: '329.95508412672484',
		tier: '1',
		player_id: '4429160',
		gsis: '00-0039040'
	},
	{
		rank: '36',
		position_rank: '15',
		name: 'Tetairoa McMillan',
		position: 'WR',
		nfl_team: 'CAR',
		adp: '36.1',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4685472.png',
		projected_points: '231.34',
		value_over_replacement: '51.31',
		expected_games: '14.399498182234975',
		floor_points: '151.8744785892166',
		median_points: '231.39993578851605',
		ceiling_points: '310.9253929878155',
		tier: '3',
		player_id: '4685472',
		gsis: '00-0040124'
	},
	{
		rank: '43',
		position_rank: '18',
		name: 'Jameson Williams',
		position: 'WR',
		nfl_team: 'DET',
		adp: '54.6',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4426388.png',
		projected_points: '222.91',
		value_over_replacement: '42.879999999999995',
		expected_games: '15.341703799378285',
		floor_points: '160.11122275951547',
		median_points: '222.91495620496647',
		ceiling_points: '285.71868965041745',
		tier: '3',
		player_id: '4426388',
		gsis: '00-0037240'
	},
	{
		rank: '45',
		position_rank: '20',
		name: 'Emeka Egbuka',
		position: 'WR',
		nfl_team: 'TB',
		adp: '41.1',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4567750.png',
		projected_points: '221.22',
		value_over_replacement: '41.19',
		expected_games: '14.399498182234975',
		floor_points: '144.68489821626474',
		median_points: '221.1762920791292',
		ceiling_points: '297.6676859419937',
		tier: '3',
		player_id: '4567750',
		gsis: '00-0040129'
	},
	{
		rank: '53',
		position_rank: '11',
		name: 'Derrick Henry',
		position: 'RB',
		nfl_team: 'BAL',
		adp: '39',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/3043078.png',
		projected_points: '211.5',
		value_over_replacement: '63.34',
		expected_games: '15.380189410906095',
		floor_points: '152.70839942463425',
		median_points: '211.4776043999588',
		ceiling_points: '270.24680937528336',
		tier: '1',
		player_id: '3043078',
		gsis: '00-0032764'
	},
	{
		rank: '54',
		position_rank: '22',
		name: 'Davante Adams',
		position: 'WR',
		nfl_team: 'LAR',
		adp: '50.4',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/16800.png',
		projected_points: '210.59',
		value_over_replacement: '30.560000000000002',
		expected_games: '13.906262422238328',
		floor_points: '130.5176692311153',
		median_points: '210.54081307268828',
		ceiling_points: '290.56395691426127',
		tier: '3',
		player_id: '16800',
		gsis: '00-0031381'
	},
	{
		rank: '55',
		position_rank: '23',
		name: 'DJ Moore',
		position: 'WR',
		nfl_team: 'BUF',
		adp: '51.8',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/3915416.png',
		projected_points: '206.88',
		value_over_replacement: '26.849999999999994',
		expected_games: '14.473267048556085',
		floor_points: '135.5420415161625',
		median_points: '206.82298612386646',
		ceiling_points: '278.1039307315704',
		tier: '3',
		player_id: '3915416',
		gsis: '00-0034827'
	},
	{
		rank: '60',
		position_rank: '27',
		name: 'Terry McLaurin',
		position: 'WR',
		nfl_team: 'WSH',
		adp: '47.5',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/3121422.png',
		projected_points: '197.96',
		value_over_replacement: '17.930000000000007',
		expected_games: '13.693509218664698',
		floor_points: '119.47302516902307',
		median_points: '198.00814330189155',
		ceiling_points: '276.54326143476004',
		tier: '4',
		player_id: '3121422',
		gsis: '00-0035659'
	},
	{
		rank: '63',
		position_rank: '13',
		name: 'Breece Hall',
		position: 'RB',
		nfl_team: 'NYJ',
		adp: '39.6',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4427366.png',
		projected_points: '191.52',
		value_over_replacement: '43.360000000000014',
		expected_games: '14.838535529431443',
		floor_points: '130.03409653208269',
		median_points: '191.56549368495993',
		ceiling_points: '253.09689083783718',
		tier: '2',
		player_id: '4427366',
		gsis: '00-0038120'
	},
	{
		rank: '67',
		position_rank: '30',
		name: 'Luther Burden III',
		position: 'WR',
		nfl_team: 'CHI',
		adp: '46.5',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4685278.png',
		projected_points: '186.92',
		value_over_replacement: '6.889999999999986',
		expected_games: '13.198129493159644',
		floor_points: '106.41812023753303',
		median_points: '186.88551362314055',
		ceiling_points: '267.35290700874805',
		tier: '4',
		player_id: '4685278',
		gsis: '00-0040735'
	},
	{
		rank: '70',
		position_rank: '31',
		name: 'Mike Evans',
		position: 'WR',
		nfl_team: 'SF',
		adp: '57.7',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/16737.png',
		projected_points: '185.82',
		value_over_replacement: '5.789999999999992',
		expected_games: '13.238520319061498',
		floor_points: '106.25335430930399',
		median_points: '185.86882527962342',
		ceiling_points: '265.4842962499429',
		tier: '4',
		player_id: '16737',
		gsis: '00-0031408'
	},
	{
		rank: '73',
		position_rank: '14',
		name: 'Jeremiyah Love',
		position: 'RB',
		nfl_team: 'ARI',
		adp: '40.7',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4870808.png',
		projected_points: '184.41',
		value_over_replacement: '36.25',
		expected_games: '11.585567886382746',
		floor_points: '86.18902518408386',
		median_points: '184.44224075121332',
		ceiling_points: '282.6954563183428',
		tier: '2',
		player_id: '4870808',
		gsis: '00-0041027'
	},
	{
		rank: '75',
		position_rank: '15',
		name: 'Travis Etienne Jr.',
		position: 'RB',
		nfl_team: 'NO',
		adp: '46.3',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4239996.png',
		projected_points: '182.94',
		value_over_replacement: '34.78',
		expected_games: '14.79540356083338',
		floor_points: '123.05021760489089',
		median_points: '182.87118801190056',
		ceiling_points: '242.69215841891022',
		tier: '2',
		player_id: '4239996',
		gsis: '00-0036973'
	},
	{
		rank: '80',
		position_rank: '37',
		name: 'Marvin Harrison Jr.',
		position: 'WR',
		nfl_team: 'ARI',
		adp: '68.9',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4432708.png',
		projected_points: '179.11',
		value_over_replacement: '-0.9199999999999875',
		expected_games: '13.912986139129364',
		floor_points: '109.43495486686773',
		median_points: '179.0601316105949',
		ceiling_points: '248.6853083543221',
		tier: '4',
		player_id: '4432708',
		gsis: '00-0039849'
	},
	{
		rank: '91',
		position_rank: '16',
		name: "D'Andre Swift",
		position: 'RB',
		nfl_team: 'CHI',
		adp: '53.6',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4259545.png',
		projected_points: '164.09',
		value_over_replacement: '15.930000000000007',
		expected_games: '14.844028143331972',
		floor_points: '109.5116671177397',
		median_points: '164.0265109838183',
		ceiling_points: '218.5413548498969',
		tier: '3',
		player_id: '4259545',
		gsis: '00-0036275'
	},
	{
		rank: '93',
		position_rank: '17',
		name: 'Kyren Williams',
		position: 'RB',
		nfl_team: 'LAR',
		adp: '42.3',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4430737.png',
		projected_points: '163.84',
		value_over_replacement: '15.680000000000007',
		expected_games: '14.805111710962073',
		floor_points: '109.01022659907562',
		median_points: '163.89258664035015',
		ceiling_points: '218.77494668162467',
		tier: '3',
		player_id: '4430737',
		gsis: '00-0037840'
	},
	{
		rank: '95',
		position_rank: '4',
		name: 'Tyler Warren',
		position: 'TE',
		nfl_team: 'IND',
		adp: '54',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4431459.png',
		projected_points: '162.52',
		value_over_replacement: '22.480000000000018',
		expected_games: '15.483376479270305',
		floor_points: '117.63336604295793',
		median_points: '162.5754530323382',
		ceiling_points: '207.51754002171847',
		tier: '1',
		player_id: '4431459',
		gsis: '00-0040128'
	},
	{
		rank: '96',
		position_rank: '18',
		name: 'Bucky Irving',
		position: 'RB',
		nfl_team: 'TB',
		adp: '57.4',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4596448.png',
		projected_points: '162.08',
		value_over_replacement: '13.920000000000016',
		expected_games: '13.658706563343362',
		floor_points: '96.24788049278301',
		median_points: '162.12884690688568',
		ceiling_points: '228.00981332098837',
		tier: '3',
		player_id: '4596448',
		gsis: '00-0039361'
	},
	{
		rank: '98',
		position_rank: '19',
		name: 'Javonte Williams',
		position: 'RB',
		nfl_team: 'DAL',
		adp: '44',
		pos_adp: '',
		headshot_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/4361579.png',
		projected_points: '161.36',
		value_over_replacement: '13.200000000000017',
		expected_games: '14.844028143331972',
		floor_points: '107.49981094669823',
		median_points: '161.35458591801853',
		ceiling_points: '215.20936088933883',
		tier: '3',
		player_id: '4361579',
		gsis: '00-0036997'
	}
];

/** Our rank by points over replacement on the full board, and the 12-team round it falls in. */
const RANKS: Readonly<Record<string, { ourRank: number; vorRound: number }>> = {
	'4426388': {
		ourRank: 35,
		vorRound: 3
	},
	'3121422': {
		ourRank: 52,
		vorRound: 5
	},
	'3915416': {
		ourRank: 43,
		vorRound: 4
	},
	'4870808': {
		ourRank: 39,
		vorRound: 4
	},
	'4361579': {
		ourRank: 57,
		vorRound: 5
	},
	'4427366': {
		ourRank: 34,
		vorRound: 3
	},
	'16737': {
		ourRank: 68,
		vorRound: 6
	},
	'2577417': {
		ourRank: 48,
		vorRound: 4
	},
	'4040715': {
		ourRank: 51,
		vorRound: 5
	},
	'4429160': {
		ourRank: 8,
		vorRound: 1
	},
	'4685278': {
		ourRank: 65,
		vorRound: 6
	},
	'4685472': {
		ourRank: 29,
		vorRound: 3
	},
	'4567750': {
		ourRank: 37,
		vorRound: 4
	},
	'3043078': {
		ourRank: 27,
		vorRound: 3
	},
	'4432708': {
		ourRank: 85,
		vorRound: 8
	},
	'4596448': {
		ourRank: 56,
		vorRound: 5
	},
	'4259545': {
		ourRank: 53,
		vorRound: 5
	},
	'4374302': {
		ourRank: 4,
		vorRound: 1
	},
	'4361370': {
		ourRank: 9,
		vorRound: 1
	},
	'16800': {
		ourRank: 42,
		vorRound: 4
	},
	'4430737': {
		ourRank: 54,
		vorRound: 5
	},
	'4239996': {
		ourRank: 40,
		vorRound: 4
	},
	'4431459': {
		ourRank: 47,
		vorRound: 4
	}
};

function isPosition(value: string): value is Position {
	return (POSITIONS as readonly string[]).includes(value);
}

function toNumber(row: BoardCsvRow, column: keyof BoardCsvRow): number {
	const value = Number(row[column]);
	if (row[column] === '' || !Number.isFinite(value)) {
		throw new Error(`Fixture row ${row.player_id} has no number in ${column}.`);
	}
	return value;
}

function toBoardPlayer(row: BoardCsvRow): BoardPlayer {
	const rank = RANKS[row.player_id];
	if (!rank) throw new Error(`Fixture row ${row.player_id} has no derived rank.`);
	if (!isPosition(row.position))
		throw new Error(`Fixture row ${row.player_id} has position ${row.position}.`);
	return {
		id: row.player_id,
		name: row.name,
		position: row.position,
		positionRank: toNumber(row, 'position_rank'),
		team: row.nfl_team,
		headshot: row.headshot_url,
		ourRank: rank.ourRank,
		vorRound: rank.vorRound,
		adp: row.adp === '' ? null : toNumber(row, 'adp'),
		projected: toNumber(row, 'projected_points'),
		vor: toNumber(row, 'value_over_replacement'),
		expectedGames: toNumber(row, 'expected_games'),
		floor: toNumber(row, 'floor_points'),
		median: toNumber(row, 'median_points'),
		ceiling: toNumber(row, 'ceiling_points'),
		// The CSV numbers tiers from 0. The product numbers them from 1.
		tier: toNumber(row, 'tier') + 1
	};
}

const PLAYERS: ReadonlyMap<string, BoardPlayer> = new Map(
	ROWS.map((row) => [row.player_id, toBoardPlayer(row)])
);

function player(id: string): BoardPlayer {
	const found = PLAYERS.get(id);
	if (!found) throw new Error(`No fixture player ${id}.`);
	return found;
}

function byName(name: string): BoardPlayer {
	const found = [...PLAYERS.values()].find((p) => p.name === name);
	if (!found) throw new Error(`No fixture player named ${name}.`);
	return found;
}

/** Every player name in the fixture, for the build's glyph guard. */
export const FIXTURE_PLAYER_NAMES: readonly string[] = ROWS.map((row) => row.name);

/** The rows on the mock's 2026 PPR board. */
export const BOARD_SIZE = 400;

/** The three value cells: round 1 green, round 3 green, below replacement. */
export const VALUE_PLAYERS: readonly BoardPlayer[] = [
	byName('Chris Olave'),
	byName('Tetairoa McMillan'),
	byName('Marvin Harrison Jr.')
];

/** WR tier 3 on the PPR board, its drop to tier 4 as the run writes one, to a tenth (Lane 66q). */
export const WR_TIER = {
	tier: 3,
	count: 9,
	group: { one: 'WR', many: 'WRs' },
	cliff: { drop: 16.8, nextTier: 4 } satisfies TierCliff
};

/** The solo room at pick 5.08 of a 12-team PPR mock, slot 8, seed 2026. */
export const SOLO_ROOM = {
	now: 56,
	since: 41,
	next: 65,
	call: player('4426388'),
	runner: player('2577417'),
	/** The call's chance of lasting to your next pick. */
	callChance: 1.3634829010014169e-8,
	/** The runner-up's chance of lasting to your next pick. */
	runnerChance: 0.972591822368457,
	went: [
		{ player: player('4870808'), pick: 42, queued: true },
		{ player: player('4361579'), pick: 43, queued: false },
		{ player: player('4567750'), pick: 44, queued: true },
		{ player: player('4239996'), pick: 45, queued: true },
		{ player: player('4430737'), pick: 46, queued: false },
		{ player: player('3121422'), pick: 47, queued: false },
		{ player: player('4685278'), pick: 48, queued: false },
		{ player: player('4259545'), pick: 49, queued: false },
		{ player: player('3915416'), pick: 50, queued: false },
		{ player: player('4431459'), pick: 51, queued: false },
		{ player: player('16800'), pick: 52, queued: true },
		{ player: player('4596448'), pick: 53, queued: false },
		{ player: player('16737'), pick: 54, queued: false },
		{ player: player('4040715'), pick: 55, queued: false }
	] satisfies WentPick[],
	rosterSize: 14
};

const MY_PICKS: Readonly<Record<string, number>> = {
	'4374302': 8,
	'4429160': 17,
	'3043078': 32,
	'4427366': 41
};

function myPick(id: string): number {
	const pick = MY_PICKS[id];
	if (pick === undefined) throw new Error(`Fixture player ${id} is not on your team.`);
	return pick;
}

/** Your team at 5.08: starters in lineup order by projected points, then the bench. */
export const SOLO_TEAM: readonly TeamSlot[] = [
	{ slot: 'QB', player: null, pick: null },
	{ slot: 'RB', player: player('4429160'), pick: myPick('4429160') },
	{ slot: 'RB', player: player('3043078'), pick: myPick('3043078') },
	{ slot: 'WR', player: player('4374302'), pick: myPick('4374302') },
	{ slot: 'WR', player: null, pick: null },
	{ slot: 'TE', player: null, pick: null },
	{ slot: 'FLEX', player: player('4427366'), pick: myPick('4427366') }
];

/** The lobby at pick 5.06: jpk88 on the clock, your pick at 5.08. */
export const LOBBY_BUG = { now: 54, onClock: 'jpk88', secondsLeft: 19, yourPick: 56 };
