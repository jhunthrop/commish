<script lang="ts">
	import { memberZone } from '#lib/format/clock.ts';
	import BasisBlock from '#lib/ui/BasisBlock.svelte';
	import { onMount } from 'svelte';
	import { askedPlayer } from '../box/asked.ts';
	import { links } from '#lib/site/links.ts';
	import type { LeagueHost } from '../api.ts';
	import {
		copiedTrade,
		heldTrades,
		offerText,
		tradeBasis,
		type CopiedTrade
	} from '../box/trades.ts';
	import TradeBuilder from './TradeBuilder.svelte';
	import type { TradeAdvice, TradeCheck, TradeCheckInput, TradeRow, TradeTeam } from './api.ts';
	import { BUILDER_LINES, openingPicks, presetsFrom, type Picks } from './builder.ts';
	import { page } from '$app/state';
	import { boxRow, type BoxRow } from '../box/box.ts';
	import type { ScreenOffer } from '#lib/player/shelf-state.ts';
	import { providePlayerShelf } from '#lib/player/shelf-host.ts';
	import PlayerShelfLayer from '#lib/player/PlayerShelfLayer.svelte';

	/** The Trades screen as one experience (Lane 260, after Lane 66g's table and builder; dense since
	 * Lane 268): the builder is the screen, my roster beside a chosen team's with a tick on every row
	 * and the verdict read again on every tick, and the finder's trades are its presets, one tap each to
	 * load, the best first (no decision line: the Best idea is where our best trade shows, and loading
	 * it shows it in full); the basis said once under it. The verb follows the moves rule:
	 * Propose on the platform where it takes a proposal from here (none today), else Open the
	 * platform's trades, which copies the offer and opens its page. We never send one. */
	interface Props {
		advice: TradeAdvice;
		host: LeagueHost;
		/** The member's team, as the switch names it, over the builder's box. */
		me: { name: string; aside: string };
		/** Checks one trade the member built. */
		check: (trade: TradeCheckInput) => Promise<TradeCheck>;
		/** Puts the offer on the clipboard. */
		copy?: (text: string) => Promise<void>;
		/** The instant the answer was read, in ms: the page's clock the rows and the basis draw at. */
		now: number;
	}

	let {
		advice: answer,
		host,
		me,
		check,
		copy = (text) => navigator.clipboard.writeText(text),
		now
	}: Props = $props();

	/** No change this week on a trade moving a player whose game has kicked off (Lane 85). */
	const advice = $derived(heldTrades(answer, now));

	/** The builder's id, for the shelf's verb that opens it on a player. */
	const BUILDER_ID = 'trade-builder';
	/** The basis's id, which the builder's "What the figures are" links to. */
	const BASIS_ID = 'trades-basis';

	const presets = $derived(presetsFrom(advice.teams));

	/** The picks the builder opens with, a count that makes it again for each opening a verb asks for,
	 * and whether it takes the focus (not on the page's own load). */
	// svelte-ignore state_referenced_locally
	let building = $state<{ picks: Picks; opening: number; focus: boolean }>({
		picks: openingPicks(presetsFrom(heldTrades(answer, now).teams)),
		opening: 0,
		focus: false
	});

	function build(picks: Picks): void {
		building = { picks, opening: building.opening + 1, focus: true };
	}

	/** Every line the builder can show, for the Game cell's read said once. */
	const lines = $derived([
		...advice.roster,
		...advice.teams.flatMap((t) => [...t.roster, ...t.trades.flatMap((r) => [...r.give, ...r.get])])
	]);
	/** One paragraph, the zone named in the page's head (Lane 66t). */
	const basis = $derived(
		tradeBasis(
			advice,
			host,
			lines,
			'builder',
			{ record: links.record() },
			{ zone: memberZone(), zoned: false },
			now
		)
	);

	/** The player shelf's verb (Lane 113): Build a trade with him in it, from the team that holds him,
	 * or from the member's side, with the team our best idea names, when he is the member's. */
	function shelfOffer({ key }: BoxRow): ScreenOffer | null {
		const holder = advice.teams.find((team) => team.roster.some((l) => l.player.host_id === key));
		const mine = advice.roster.some((l) => l.player.host_id === key);
		if (holder === undefined && !mine) return null;
		const run = (): void => {
			if (holder !== undefined) build({ team: holder.roster_id, give: [], get: [key] });
			else build({ ...openingPicks(presets), give: [key] });
		};
		return { label: BUILDER_LINES.open, line: null, href: null, run, focus: BUILDER_ID };
	}

	const shelf = providePlayerShelf({
		screen: 'trades',
		now: () => now,
		league: () => ({ id: page.params.id ?? '', host }),
		offer: shelfOffer,
		rowOf: (slug) => {
			const line = lines.find((l) => l.slug === slug);
			return line === undefined ? null : boxRow(line, '', memberZone(), false, now);
		}
	});

	/** A player page's "Trade for him" names him (?player=, Lane 66h): the builder opens with him
	 * picked from the team that holds him. */
	onMount(() => {
		const asked = askedPlayer(window.location.href);
		if (asked === null) return;
		const holder = advice.teams.find((team) =>
			team.roster.some((line) => line.player.board_id === asked)
		);
		const line = holder?.roster.find((l) => l.player.board_id === asked);
		if (holder && line && line.player.host_id !== '')
			build({ team: holder.roster_id, give: [], get: [line.player.host_id] });
	});

	/** Copies a trade's offer for the member to propose on the platform: the line under the verb. */
	async function propose(
		team: TradeTeam,
		row: Pick<TradeRow, 'give' | 'get'>
	): Promise<CopiedTrade> {
		try {
			await copy(offerText(team, row));
			return copiedTrade(host, true);
		} catch {
			return copiedTrade(host, false);
		}
	}

	/** Copies the trade as text in our words, for Share. */
	async function share(text: string): Promise<boolean> {
		try {
			await copy(text);
			return true;
		} catch {
			return false;
		}
	}
</script>

{#key building.opening}
	<TradeBuilder
		id={BUILDER_ID}
		teams={advice.teams}
		roster={advice.roster}
		{me}
		{host}
		moves={advice.moves}
		{presets}
		start={building.picks}
		focus={building.focus}
		basis={advice.check_basis}
		basisHref="#{BASIS_ID}"
		href={advice.host_trades_url}
		hostNote={advice.host_note}
		{check}
		{propose}
		{share}
		{now}
	/>
{/key}
<BasisBlock parts={basis} id={BASIS_ID} />
<PlayerShelfLayer host={shelf} />
