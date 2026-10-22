// The stand-in run's kickers and defenses (Lane 132, B111): the board's market rows, in draft order
// after every ranked row, and their index entries, as the nightly writes them (research/nightly/build
// pages.py, MARKET_ORDER). Without them the board draws no K or DST tab, so the in-season week's
// kickers and defenses (the API's GET /order/week) had no page on the one prepared run.
// Sources, all real: the same preseason ADP captures as the ranked rows (adp_snapshots, before the
// first kickoff, averaged), each kicker placed through the crosswalk to the provider's directory and
// each defense by its club (research.provider_players: id, name, club, face). A kicker or a defense
// the drafts do not take is not on the board (the September ruling).
import type postgres from 'postgres';
import type { MarketEntry, MarketRow } from '../src/lib/run/schema.ts';
import { tenth } from './tenth.ts';

/** A name as a slug: lower case words joined by hyphens, marks dropped. */
export function slugOf(name: string): string {
	return name
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/** A defense's ADP id names its club after this prefix. */
const DEFENSE_ADP = 'team-def:';

interface Drafted {
	id: string;
	name: string;
	position: 'K' | 'DST';
	team: string;
	headshot: string | null;
	adp: number;
}

interface MarketInputs {
	feed: string;
	kickoff: Date;
	/** The club code the run uses for a provider's or a feed's code. */
	canonicalClub: (code: string) => string;
	/** The ranked rows' count: a market row's place on the whole board comes after every one. */
	ranked: number;
	/** The ranked players' slugs, which a market row's must not take. */
	taken: ReadonlySet<string>;
}

async function drafted(sql: postgres.Sql, inputs: MarketInputs): Promise<Drafted[]> {
	const kickers = await sql<
		{ id: string; name: string; team: string | null; face: string | null; adp: number }[]
	>`
		select pp.id, pp.name, pp.team, pp.headshot_url as face, avg(a.adp)::float8 as adp
		from adp_snapshots a
		join public.player_crosswalk c on c.nfl_player_id = a.player_id
		join research.provider_players pp on pp.id = c.player_id and pp.position = 'K'
		where a.source = ${inputs.feed} and a.captured_at < ${inputs.kickoff}
		group by pp.id, pp.name, pp.team, pp.headshot_url`;
	const defenses = await sql<{ club: string; adp: number }[]>`
		select substr(player_id, ${DEFENSE_ADP.length + 1}) as club, avg(adp)::float8 as adp
		from adp_snapshots
		where source = ${inputs.feed} and captured_at < ${inputs.kickoff} and player_id like ${`${DEFENSE_ADP}%`}
		group by 1`;
	const units = await sql<{ id: string; name: string; team: string }[]>`
		select id, name, team from research.provider_players where position = 'DEF' and team is not null`;
	const unitOf = new Map(units.map((u) => [inputs.canonicalClub(u.team), u]));
	return [
		...kickers.flatMap((k): Drafted[] =>
			k.team === null
				? []
				: [
						{
							id: k.id,
							name: k.name,
							position: 'K',
							team: inputs.canonicalClub(k.team),
							headshot: k.face,
							adp: k.adp
						}
					]
		),
		...defenses.map((d): Drafted => {
			const club = inputs.canonicalClub(d.club);
			const unit = unitOf.get(club);
			if (unit === undefined) throw new Error(`No defense in the directory for ${club}.`);
			return {
				id: unit.id,
				name: unit.name,
				position: 'DST',
				team: club,
				headshot: null,
				adp: d.adp
			};
		})
	];
}

/** The board's market rows and the index's entries for them, in draft order. */
export async function marketRows(
	sql: postgres.Sql,
	inputs: MarketInputs
): Promise<{ rows: MarketRow[]; index: MarketEntry[] }> {
	const ordered = (await drafted(sql, inputs)).sort(
		(a, b) => a.adp - b.adp || a.id.localeCompare(b.id)
	);
	const seen = new Map<string, number>();
	const rows = ordered.map((d, i): MarketRow => {
		const place = (seen.get(d.position) ?? 0) + 1;
		seen.set(d.position, place);
		const base = slugOf(d.name);
		const slug = inputs.taken.has(base)
			? `${base}-${d.position.toLowerCase()}-${d.team.toLowerCase()}`
			: base;
		return {
			id: d.id,
			slug,
			name: d.name,
			position: d.position,
			positionRank: place,
			team: d.team,
			headshot: d.headshot,
			orderBasis: 'market',
			ourRank: inputs.ranked + i + 1,
			adp: tenth(d.adp),
			vorRound: null,
			projected: null,
			vor: null,
			expectedGames: null,
			floor: null,
			median: null,
			ceiling: null,
			tier: null
		};
	});
	const index = rows.map(({ id, slug, name, team, position, headshot }): MarketEntry => ({
		id,
		slug,
		name,
		team,
		position,
		headshot,
		orderBasis: 'market'
	}));
	return { rows, index };
}
