// The trade builder's check as the stand-in API answers it (inseason check.go), apart from serve.ts: a
// trade the finder lists answers the finder's own row, any other a plain stand-in for the engine.
import type {
	LineupAdvice,
	PlayerLine,
	TradeAdvice,
	TradeCheck,
	TradeCheckInput
} from '../../src/lib/league/inseason/api.ts';
import { lineupProj, seasonStrength } from './week.ts';

/** What the check reads: the finder's answer, the lineup's slots and the read's stamp. */
export interface CheckReads {
	trades: TradeAdvice;
	lineup: LineupAdvice;
	readAt: () => string;
	/** The check with its rest of season and whether each side takes it, at the clock (trade-rest.ts). */
	rest: (check: TradeCheck) => TradeCheck;
}

/** The check for one league's recorded answers. */
export function tradeChecker({
	trades,
	lineup,
	readAt,
	rest
}: CheckReads): (input: TradeCheckInput) => TradeCheck | string {
	/** The trade builder's honesty line, as the finder's answer carries it (inseason words.go
	 * TradeCheckBasis). */
	const checkBasis = trades.check_basis;
	/** The API's sentence for a team the read does not hold (inseason check.go otherTeamWords). */
	const OTHER_TEAM_WORDS = "Pick another team in this league's last read.";
	/** A gain on the wire: one decimal. */
	const tenth = (n: number): number => Math.round(n * 10) / 10;
	/** The finder's close call for them (inseason trades.go CloseCall). */
	const CLOSE_CALL = 0.5;

	/** The slots each position fills alone, from the lineup's own slots: QB, RB, WR and TE. */
	const dedicated = new Map<string, number>();
	for (const { slot } of lineup.slots) {
		if (['QB', 'RB', 'WR', 'TE'].includes(slot))
			dedicated.set(slot, (dedicated.get(slot) ?? 0) + 1);
	}

	/** The first dedicated slot a roster no longer fills, as a lineup row labels it ("RB2", "TE"); null
	 * when it fills every one. The fixture's rosters of other teams are only the players its trades name,
	 * so only the member's is counted. */
	function openSlot(roster: readonly PlayerLine[]): string | null {
		for (const [position, need] of dedicated) {
			const have = roster.filter((line) => line.player.position === position).length;
			if (have < need) return need > 1 ? `${position}${String(have + 1)}` : position;
		}
		return null;
	}

	/** One trade the member built. A trade the finder lists answers the finder's own row, as the API's
	 * shared reckoning does; any other is a plain stand-in for the engine, each lineup's change the swap
	 * of the players' points over replacement a week. A player not on the named roster is refused with
	 * the API's sentence. */
	return function tradeCheck(input: TradeCheckInput): TradeCheck | string {
		const team = trades.teams.find((t) => t.roster_id === input.team);
		if (!team) return OTHER_TEAM_WORDS;
		const pick = (roster: readonly PlayerLine[], ids: readonly string[], whose: string) =>
			ids.map(
				(id) =>
					roster.find((line) => line.player.host_id === id) ??
					`That player is not on ${whose} roster in the league's last read.`
			);
		const give = pick(trades.roster, input.give, 'your');
		const get = pick(team.roster, input.get, `${team.name}'s`);
		const refused = [...give, ...get].find((line) => typeof line === 'string');
		if (typeof refused === 'string') return refused;
		const gives = give as PlayerLine[];
		const gets = get as PlayerLine[];
		const ids = (side: readonly PlayerLine[]): string =>
			side
				.map((line) => line.player.host_id)
				.sort()
				.join('+');
		const listed = team.trades.find(
			(row) => ids(row.give) === ids(gives) && ids(row.get) === ids(gets)
		);
		const por = (side: readonly PlayerLine[]): number =>
			side.reduce((sum, line) => sum + (line.points_over_replacement ?? 0), 0);
		const swing = tenth(por(gets) - por(gives));
		const slots = lineup.slots.map((s) => s.slot);
		const without = (roster: readonly PlayerLine[], out: readonly PlayerLine[]): PlayerLine[] =>
			roster.filter((line) => !out.includes(line));
		const myBefore = lineupProj(trades.roster, slots);
		const theirBefore = lineupProj(team.roster, slots);
		const trade = listed ?? {
			give: gives,
			get: gets,
			drop: null,
			drop_reason: null,
			my_gain: swing,
			their_gain: -swing,
			close_for_them: -swing < CLOSE_CALL,
			my_proj_change: tenth(
				lineupProj([...without(trades.roster, gives), ...gets], slots) - myBefore
			),
			their_proj_change: tenth(
				lineupProj([...without(team.roster, gets), ...gives], slots) - theirBefore
			)
		};
		/** A side's totals as the API's check carries them (check.go sideTotals): the Proj before and
		 * after, and the strength before and after, after being before plus the gain. */
		const side = (
			roster: readonly PlayerLine[],
			before: number,
			change: number | null,
			gain: number
		): TradeCheck['totals']['yours'] => {
			const season = seasonStrength(roster, slots);
			return {
				proj_before: before,
				proj_after: change === null ? null : tenth(before + change),
				season_before: season,
				season_after: tenth(season + gain)
			};
		};
		const yoursOpen = openSlot([...trades.roster.filter((line) => !gives.includes(line)), ...gets]);
		return rest({
			week: trades.week,
			basis: checkBasis,
			basis_note: trades.basis_note,
			order_basis: trades.order_basis,
			refreshed: trades.refreshed,
			read_at: readAt(),
			trade,
			// The stand-in names no drop off the finder's rows, so it never refuses a trade for room.
			fills: {
				yours: yoursOpen === null,
				theirs: true,
				yours_open: yoursOpen,
				theirs_open: null,
				yours_room: true,
				theirs_room: true
			},
			totals: {
				yours: side(trades.roster, myBefore, trade.my_proj_change, trade.my_gain),
				theirs: side(team.roster, theirBefore, trade.their_proj_change, trade.their_gain)
			},
			host_trades_url: trades.host_trades_url,
			host_note: trades.host_note
		});
	};
}
