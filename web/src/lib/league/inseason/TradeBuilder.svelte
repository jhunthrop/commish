<script lang="ts">
	import { onMount } from 'svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import ToneChip from '#lib/ui/ToneChip.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import type { LeagueHost } from '../api.ts';
	import type { BoxPick } from '../box/box.ts';
	import TradeBox from '../box/TradeBox.svelte';
	import TradeBug from '../box/TradeBug.svelte';
	import TradeCopied from '../box/TradeCopied.svelte';
	import {
		bugFigures,
		checkRoom,
		gainWord,
		heldCheck,
		proposeVerb,
		TRADES,
		type CopiedTrade
	} from '../box/trades.ts';
	import type {
		PlayerLine,
		TradeCheck,
		TradeCheckInput,
		TradeMoves,
		TradeRow,
		TradeTeam
	} from './api.ts';
	import {
		BUILDER_LINES,
		MAX_A_SIDE,
		checkInput,
		checkWords,
		pickPrompt,
		pickable,
		teamChoice,
		toggle,
		type Picks
	} from './builder.ts';
	import PickSelect, { type PickGroup } from './PickSelect.svelte';
	import { focusOnOpen, hostTab } from './attach.ts';
	import { Narrowing } from './state.ts';
	import { CLOSE_FOR_THEM, teamAside } from './words.ts';

	/** The trade builder (Lane 61) as two box scores (Lane 66g): the other team chosen by name and
	 * record; a scoreboard of each side's this-week Proj and rest-of-season strength before and after
	 * the trade, its room, and the verb between them; the answer line and the honesty line; then your
	 * roster beside theirs, each a box score with a tick on every row, two a side at most. The answer
	 * is read again as you pick, on the finder's own reckoning. The verb follows the moves rule:
	 * Propose on the platform where it takes a proposal from here, else Open its trades, which copies
	 * the offer. We never send one. On a phone the boxes stack and the gains with the verb are pinned. */
	interface Props {
		id: string;
		/** Every other team, with its roster. */
		teams: readonly TradeTeam[];
		/** Your active roster. */
		roster: readonly PlayerLine[];
		/** Your team's name and record, over your box. */
		me: { name: string; aside: string };
		host: LeagueHost;
		moves: TradeMoves;
		/** The picks it opens with: a finder row's trade, or a team alone. */
		start: Picks;
		/** The builder's own line, from the finder's answer, until the first check says it. */
		basis: string;
		/** The page's basis, which says what the figures are: "What the figures are" links to it. */
		basisHref: string;
		/** The platform's trade page and the API's note when it has none. */
		href: string;
		hostNote: string | null;
		check: (trade: TradeCheckInput) => Promise<TradeCheck>;
		/** Copies the trade's offer, answering the line under the verb. */
		propose: (team: TradeTeam, row: Pick<TradeRow, 'give' | 'get'>) => Promise<CopiedTrade>;
		onclose: () => void;
		/** The instant the answer was read, in ms: the page's clock the rows draw at. */
		now: number;
	}

	let {
		id,
		teams,
		roster,
		me,
		host,
		moves,
		start,
		basis,
		basisHref,
		href,
		hostNote,
		check,
		propose,
		onclose,
		now
	}: Props = $props();

	// The panel is made again for each trade it opens with ({#key} in the screen).
	// svelte-ignore state_referenced_locally
	let picks = $state<Picks>(start);
	let answer = $state<TradeCheck | null>(null);
	let reading = $state(false);
	let problem = $state<string | null>(null);
	let copied = $state<CopiedTrade | null>(null);

	// svelte-ignore state_referenced_locally
	const asking = new Narrowing(check);

	const team = $derived(teams.find((t) => t.roster_id === picks.team) ?? null);
	const sentence = $derived(answer === null ? pickPrompt(picks) : checkWords(answer));
	const close = $derived(
		answer !== null &&
			answer.fills.yours &&
			answer.fills.theirs &&
			answer.fills.yours_room &&
			answer.fills.theirs_room &&
			answer.trade.my_gain > 0
			? answer.trade.close_for_them && answer.trade.their_gain > 0
			: false
	);
	const verb = $derived(proposeVerb(moves, host));
	/** The teams as the picker names them: name, owner and record. */
	const teamGroups = $derived<PickGroup[]>([
		{
			label: null,
			options: teams.map((t) => ({ value: String(t.roster_id), label: teamChoice(t) }))
		}
	]);
	const page = $derived(answer?.host_trades_url ?? href);
	const room = $derived(answer ? checkRoom(answer) : { yours: '', theirs: '' });
	const dropId = $derived(answer?.trade.drop?.player.host_id ?? null);

	/** Reads the answer for the picks, keeping only the latest; the last answer stays, quieter, while
	 * the next is read. */
	async function ask(): Promise<void> {
		const input = checkInput(picks);
		problem = null;
		copied = null;
		if (input === null) {
			answer = null;
			reading = false;
			void asking.choose(null);
			return;
		}
		reading = true;
		const outcome = await asking.choose(input);
		if (outcome.kind === 'overtaken') return;
		reading = false;
		// No change this week on a trade moving a player whose game has kicked off (Lane 85).
		if (outcome.kind === 'answer') answer = heldCheck(outcome.answer, now);
		if (outcome.kind === 'failed') {
			answer = null;
			problem = outcome.sentence;
		}
	}

	function choose(rosterId: number): void {
		picks = { team: rosterId, give: picks.give, get: [] };
		void ask();
	}

	function tap(side: 'give' | 'get', hostId: string): void {
		picks = { ...picks, [side]: toggle(picks[side], hostId) };
		void ask();
	}

	/** A row's tick: a player no trade takes has none, the member's drop is marked, a full side holds
	 * the rest back. */
	function tickOf(side: 'give' | 'get'): (line: PlayerLine) => BoxPick {
		return (line) => {
			const hostId = line.player.host_id;
			const on = picks[side].includes(hostId);
			if (side === 'give' && hostId === dropId)
				return { state: 'drop', disabled: true, toggle: null };
			if (!pickable(line)) return { state: 'no', disabled: true, toggle: null };
			return {
				state: on ? 'on' : 'off',
				disabled: !on && picks[side].length >= MAX_A_SIDE,
				toggle: () => tap(side, hostId)
			};
		};
	}

	/** What a side holds, at its box's head. */
	function holdsWords(side: 'give' | 'get'): string {
		if (picks[side].length >= MAX_A_SIDE) return BUILDER_LINES.full;
		const label = side === 'give' ? BUILDER_LINES.give : BUILDER_LINES.get;
		return `${label} ${String(picks[side].length)}`;
	}

	async function press(): Promise<void> {
		if (team === null || answer === null) return;
		copied = await propose(team, answer.trade);
	}

	onMount(() => {
		if (checkInput(picks) !== null) void ask();
	});
</script>

{#snippet action(fill: boolean)}
	<span class="act" {@attach hostTab(page)}>
		<Verb
			href={page === '' ? undefined : page}
			disabled={page === '' || answer === null}
			{fill}
			onclick={() => void press()}>{verb}</Verb
		>
	</span>
{/snippet}

<div {id} class="builder" tabindex="-1" {@attach focusOnOpen}>
	<Panel as="section" label={BUILDER_LINES.open} edge="accent">
		<div class="body">
			<header class="head">
				<h2>{BUILDER_LINES.open}</h2>
				<PickSelect
					label={BUILDER_LINES.team}
					value={picks.team === null ? '' : String(picks.team)}
					groups={teamGroups}
					onchange={(value: string) => choose(Number(value))}
				/>
				<span class="not-now"><Quiet onclick={onclose}>{BUILDER_LINES.notNow}</Quiet></span>
			</header>
			<div class:reading>
				<TradeBug
					gainHead={TRADES.gainHead}
					yours={{
						name: me.name,
						figures: bugFigures(
							answer?.totals.yours ?? null,
							answer?.trade.my_gain ?? null,
							answer?.trade.my_proj_change ?? null
						),
						room: room.yours
					}}
					theirs={{
						name: team?.name ?? '',
						figures: bugFigures(
							answer?.totals.theirs ?? null,
							answer?.trade.their_gain ?? null,
							answer?.trade.their_proj_change ?? null
						),
						room: room.theirs
					}}
				>
					{#snippet verb()}
						{@render action(true)}
						{#if copied}<TradeCopied line={copied} href={page} />{:else if moves.reason}<span
								>{moves.reason}</span
							>{:else if hostNote}<span>{hostNote}</span>{/if}
					{/snippet}
				</TradeBug>
			</div>
			<div class="words" aria-live="polite" aria-busy={reading}>
				{#if problem}
					<ProblemLine>{problem}</ProblemLine>
				{:else}
					<p class="line" class:quiet={answer === null} class:reading>{sentence}</p>
				{/if}
				{#if close}<ToneChip tone="even">{CLOSE_FOR_THEM}</ToneChip>{/if}
			</div>
			<p class="own" data-basis="builder">
				{answer?.basis ?? basis}
				<a href={basisHref}>{BUILDER_LINES.figures}</a>
			</p>
			<div class="boxes">
				<TradeBox
					team={me.name}
					mine
					aside={me.aside}
					holds={holdsWords('give')}
					lines={roster}
					pickOf={tickOf('give')}
					{now}
				/>
				{#if team}
					<TradeBox
						team={team.name}
						aside={teamAside(team)}
						holds={holdsWords('get')}
						lines={team.roster}
						pickOf={tickOf('get')}
						{now}
					/>
				{/if}
			</div>
			<!-- On a phone the gains and the verb are pinned above the tab bar, so each tap's answer stays in
			     sight. -->
			<div class="pin">
				<span class="pin-gains"
					>{#if answer}<b>{gainWord(answer.trade.my_gain)}</b>
						{TRADES.aWeekForYou}, {gainWord(answer.trade.their_gain)}
						{TRADES.forTheirs}{:else}{sentence}{/if}</span
				>
				{@render action(false)}
				{#if copied}<span class="pin-said"><TradeCopied line={copied} href={page} /></span>{/if}
			</div>
		</div>
	</Panel>
</div>

<style>
	.builder {
		outline: none;
		scroll-margin: var(--s-4);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2) var(--s-4);
	}

	h2 {
		margin: 0;
		font-family: var(--font-num);
		font-size: var(--t-head);
		font-weight: 800;
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.01em;
	}

	.not-now {
		margin-left: auto;
	}

	.words {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--s-2) var(--s-3);
	}

	.line {
		margin: 0;
		max-width: 90ch;
		font-size: var(--t-md);
		font-weight: 600;
		line-height: 1.4;
	}

	.quiet {
		color: var(--ink-2);
		font-weight: 400;
	}

	/* The builder's own line: what the scoreboard is, then the way to what its figures are. */
	.own {
		margin: 0;
		font-size: var(--t-sm);
		line-height: 1.45;
		color: var(--ink-3);
	}

	.own a {
		color: var(--accent-text);
		white-space: nowrap;
	}

	/* While the next answer is read, the last one stays, quieter. */
	.reading {
		opacity: 0.6;
	}

	.act {
		display: flex;
	}

	.boxes {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--s-3);
		align-items: start;
	}

	.pin {
		display: none;
	}

	@media (max-width: 1180px) {
		.boxes {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 760px) {
		h2 {
			font-size: var(--t-xl);
		}

		.line {
			font-size: var(--t-sm);
		}

		.pin {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			justify-content: space-between;
			gap: var(--s-1) var(--s-2);
			position: sticky;
			bottom: calc(var(--tab-bar-h) + env(safe-area-inset-bottom, 0px));
			z-index: 10;
			margin: 0 calc(var(--s-4) * -1) calc(var(--s-4) * -1);
			padding: var(--s-2) var(--s-3);
			background: var(--scoreboard);
			color: var(--scoreboard-ink);
			font-size: var(--t-xs);
		}

		.pin-gains {
			flex: 1;
			min-width: 0;
		}

		.pin-gains b {
			font-family: var(--font-num);
			font-size: var(--t-lg);
			color: var(--scoreboard-gain-ink);
		}

		.pin-said {
			flex-basis: 100%;
		}

		.pin-said :global(a) {
			color: var(--scoreboard-ink);
		}
	}
</style>
