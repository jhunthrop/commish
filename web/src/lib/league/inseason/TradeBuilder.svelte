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
		ANALYZER_LINES,
		BUILDER_LINES,
		MAX_A_SIDE,
		checkInput,
		checkWords,
		fillsBoth,
		gainBars,
		pickPrompt,
		pickable,
		samePicks,
		shareText,
		teamChoice,
		toggle,
		type Picks,
		type Preset
	} from './builder.ts';
	import PickSelect, { type PickGroup } from './PickSelect.svelte';
	import { focusOnOpen, hostTab } from './attach.ts';
	import { Narrowing } from './state.ts';
	import { CLOSE_FOR_THEM, teamAside } from './words.ts';

	/** The Trades screen's one surface (Lane 61, Lane 66g, one experience since Lane 260): the other
	 * team chosen by name and record at the top; our ideas (the finder's best trade with each team) as
	 * presets, one tap each to load into the ticks; your roster beside theirs, each a box score with a
	 * tick and our rank on every row, two a side at most; then the verdict, read again on every tick
	 * with no submit: a scoreboard of each side's this-week Proj and rest-of-season strength before
	 * and after with a bar per side and the verb between them, the answer line naming the players
	 * changing hands, and the honesty line. The verdict stays in sight at a desk and is pinned on a
	 * phone. The verb follows the moves rule: Propose on the platform where it takes a proposal from
	 * here, else Open its trades, which copies the offer; Share copies the trade as text. We never send
	 * one. */
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
		/** Our ideas, best first: each loads its trade into the ticks. */
		presets: readonly Preset[];
		/** The picks it opens with: the best idea's team alone, or a player the member asked for. */
		start: Picks;
		/** Whether it takes the focus as it opens: when a verb elsewhere opened it, not on the page's load. */
		focus: boolean;
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
		/** Copies the trade as text in our words; false when the browser would not. */
		share: (text: string) => Promise<boolean>;
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
		presets,
		start,
		focus,
		basis,
		basisHref,
		href,
		hostNote,
		check,
		propose,
		share,
		now
	}: Props = $props();

	// The surface is made again for each opening a verb elsewhere asks for ({#key} in the screen).
	// svelte-ignore state_referenced_locally
	let picks = $state<Picks>(start);
	let answer = $state<TradeCheck | null>(null);
	let reading = $state(false);
	let problem = $state<string | null>(null);
	let copied = $state<CopiedTrade | null>(null);
	let shared = $state<string | null>(null);

	// svelte-ignore state_referenced_locally
	const asking = new Narrowing(check);

	const team = $derived(teams.find((t) => t.roster_id === picks.team) ?? null);
	const sentence = $derived(
		team === null ? ANALYZER_LINES.noTeam : answer === null ? pickPrompt(picks) : checkWords(answer)
	);
	const close = $derived(
		answer !== null && fillsBoth(answer) && answer.trade.my_gain > 0
			? answer.trade.close_for_them && answer.trade.their_gain > 0
			: false
	);
	const verb = $derived(proposeVerb(moves, host));
	/** The teams as the picker names them: name, owner and record, after a first choice while none is
	 * chosen. */
	const teamGroups = $derived<PickGroup[]>([
		{
			label: null,
			options: [
				...(picks.team === null ? [{ value: '', label: ANALYZER_LINES.pickTeam }] : []),
				...teams.map((t) => ({ value: String(t.roster_id), label: teamChoice(t) }))
			]
		}
	]);
	const page = $derived(answer?.host_trades_url ?? href);
	const room = $derived(answer ? checkRoom(answer) : { yours: '', theirs: '' });
	const bars = $derived(gainBars(answer?.trade.my_gain ?? null, answer?.trade.their_gain ?? null));
	const dropId = $derived(answer?.trade.drop?.player.host_id ?? null);
	const canShare = $derived(team !== null && answer !== null && fillsBoth(answer));

	/** Reads the answer for the picks, keeping only the latest; the last answer stays, quieter, while
	 * the next is read. */
	async function ask(): Promise<void> {
		const input = checkInput(picks);
		problem = null;
		copied = null;
		shared = null;
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

	/** One tap loads an idea into the ticks; the member changes it freely from there. */
	function load(preset: Preset): void {
		picks = preset.picks;
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

	async function shareTrade(): Promise<void> {
		if (team === null || answer === null) return;
		shared = (await share(shareText(team, answer))) ? ANALYZER_LINES.shared : TRADES.copyFailed;
	}

	/** Takes the focus as it opens when a verb elsewhere opened it. */
	function takeFocus(node: HTMLElement): void {
		if (focus) focusOnOpen(node);
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

<div {id} class="builder" tabindex="-1" {@attach takeFocus}>
	<Panel as="section" label={BUILDER_LINES.open} edge="accent">
		<div class="body">
			<header class="head">
				<h2>{BUILDER_LINES.open}</h2>
				<PickSelect
					label={BUILDER_LINES.team}
					value={picks.team === null ? '' : String(picks.team)}
					groups={teamGroups}
					onchange={(value: string) => {
						if (value !== '') choose(Number(value));
					}}
				/>
				<span class="share">
					{#if shared}<span class="said" role="status">{shared}</span>{/if}
					<Quiet size="sm" disabled={!canShare} onclick={() => void shareTrade()}
						>{ANALYZER_LINES.share}</Quiet
					>
				</span>
			</header>
			{#if presets.length > 0}
				<div class="ideas" role="group" aria-label={ANALYZER_LINES.ideas}>
					<span class="ideas-head">{ANALYZER_LINES.ideas}</span>
					<ul>
						{#each presets as preset (preset.key)}
							<li>
								<button
									type="button"
									class="idea"
									aria-pressed={samePicks(picks, preset.picks)}
									onclick={() => load(preset)}
								>
									<span class="with"
										>{#if preset.mark}<b class="mark">{preset.mark}</b>{/if}{TRADES.with}
										{preset.team.name}</span
									>
									<span class="deal">{preset.deal}</span>
									<span class="gains">{preset.gains}</span>
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
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
			<div class="verdict">
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
							room: room.yours,
							bar: bars.yours
						}}
						theirs={{
							name: team?.name ?? '',
							figures: bugFigures(
								answer?.totals.theirs ?? null,
								answer?.trade.their_gain ?? null,
								answer?.trade.their_proj_change ?? null
							),
							room: room.theirs,
							bar: bars.theirs
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
			</div>
			<p class="own" data-basis="builder">
				{answer?.basis ?? basis}
				<a href={basisHref}>{BUILDER_LINES.figures}</a>
			</p>
			<!-- On a phone the gains and the verb are pinned above the tab bar, so each tap's answer stays in
			     sight. -->
			<div class="pin">
				<span class="pin-gains"
					>{#if answer && fillsBoth(answer)}<b>{gainWord(answer.trade.my_gain)}</b>
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

	.share {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		margin-left: auto;
	}

	.said {
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	/* Our ideas: one row of presets that scrolls sideways, each a tap that loads its trade. */
	.ideas {
		display: flex;
		align-items: stretch;
		gap: var(--s-3);
		min-width: 0;
	}

	.ideas-head {
		flex: none;
		align-self: center;
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
	}

	.ideas ul {
		display: flex;
		gap: var(--s-2);
		margin: 0;
		padding: 2px;
		list-style: none;
		overflow-x: auto;
		scroll-snap-type: x proximity;
		min-width: 0;
	}

	.ideas li {
		flex: none;
		scroll-snap-align: start;
	}

	.idea {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		width: 15.5rem;
		height: 100%;
		padding: var(--s-2) var(--s-3);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.idea:hover {
		border-color: var(--line-strong);
	}

	.idea[aria-pressed='true'] {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent);
	}

	.idea:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.with {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.mark {
		margin-right: 6px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--accent-text);
	}

	.deal {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 700;
		font-size: var(--t-sm);
	}

	.gains {
		font-size: var(--t-xs);
		color: var(--ink-2);
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

	/* The verdict under the rosters stays in sight at a desk as the ticks change, held to the foot of
	   the window. */
	.verdict {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		position: sticky;
		bottom: 0;
		z-index: 5;
		margin: 0 calc(var(--s-4) * -1);
		padding: var(--s-3) var(--s-4);
		background: var(--surface);
		border-top: 1px solid var(--line-strong);
	}

	.pin {
		display: none;
	}

	@media (max-width: 1180px) {
		.boxes {
			grid-template-columns: minmax(0, 1fr);
		}

		/* The scoreboard stacks here: the verdict sits under the rosters in its place. */
		.verdict {
			position: static;
			margin: 0;
			padding: 0;
			border-top: 0;
		}
	}

	@media (max-width: 760px) {
		h2 {
			font-size: var(--t-xl);
		}

		.line {
			font-size: var(--t-sm);
		}

		.idea {
			width: 13.5rem;
		}

		.ideas {
			flex-direction: column;
			gap: var(--s-1);
		}

		.ideas-head {
			align-self: flex-start;
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
