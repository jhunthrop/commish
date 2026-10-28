<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
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
		refusalWords,
		restFigure,
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
		IDEAS_SHOWN,
		MAX_A_SIDE,
		checkInput,
		checkWords,
		countWords,
		fillsBoth,
		gainBars,
		ideaPlaces,
		moreWords,
		noIdeasFrom,
		pickPrompt,
		pickable,
		proposable,
		samePicks,
		shareText,
		teamChoice,
		toggle,
		type Answered,
		type Picks,
		type Preset
	} from './builder.ts';
	import PickSelect, { type PickGroup } from './PickSelect.svelte';
	import { focusOnOpen, hostTab } from './attach.ts';
	import { Narrowing } from './state.ts';
	import { CLOSE_FOR_THEM, teamAside } from './words.ts';

	/** The Trades screen's one surface (Lane 61, Lane 66g, one experience since Lane 260, dense since
	 * Lane 268): our ideas (the finder's best trade with each team in this league) as one row of
	 * presets, the best three and the rest a tap away, one tap each to load into the ticks; your roster
	 * beside theirs, each a box score at the Lineup's row height with a tick and our rank on every row,
	 * two a side at most, the other team chosen at the head of its roster; then the verdict, read again
	 * on every tick with no submit: a box-score row per side of its this-week Proj and rest-of-season
	 * gain a week before and after with a bar, and its room, the verb and Share beside them, the answer
	 * line under them naming the players changing hands, and the honesty line. The verdict stays in
	 * sight at a desk and is pinned on a phone. The verb follows the moves rule: Propose on the platform where it takes a proposal from
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
	/** The last answer with the picks it was read for: drawn, quieter, while the next is read, but the
	 * verbs act on it only while the picks are still the ones it answers (proposable). */
	let answered = $state<Answered | null>(null);
	const answer = $derived(answered?.check ?? null);
	let reading = $state(false);
	let problem = $state<string | null>(null);
	let copied = $state<CopiedTrade | null>(null);
	let shared = $state<string | null>(null);
	/** The roster drawn where the two stack (a phone): yours first. */
	let drawn = $state<'give' | 'get'>('give');
	/** Whether the ideas row shows every idea, or the best IDEAS_SHOWN and its "N more". */
	let allIdeas = $state(false);
	/** Our ideas, then each team the finder lists none with, its line in its place (B271). */
	const places = $derived(ideaPlaces(presets, noIdeasFrom(teams)));
	const shownIdeas = $derived(allIdeas ? places : places.slice(0, IDEAS_SHOWN));
	/** The ideas' list, so "N more" hands the focus to the first idea it shows. */
	let ideaList = $state<HTMLUListElement | null>(null);
	const IDEAS_ID = $derived(`${id}-ideas`);

	/** Shows every idea in place and moves the focus to the first one it adds, so a keyboard carries
	 * on from there (the control itself goes). */
	async function showAllIdeas(): Promise<void> {
		allIdeas = true;
		await tick();
		[...(ideaList?.querySelectorAll<HTMLElement>('.idea, .no-idea') ?? [])]
			.at(IDEAS_SHOWN)
			?.focus();
	}
	const hiddenIdeas = $derived(places.length - shownIdeas.length);

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
	/** A side would not take the answered trade on its rest of season (Lane 269): the pin says why. */
	const refusal = $derived(answer && fillsBoth(answer) ? refusalWords(answer.acceptable) : null);
	const dropId = $derived(answer?.trade.drop?.player.host_id ?? null);
	/** Propose and Share act on the answer only for the team and ticks it was read for, on a trade
	 * both rosters can make. */
	const live = $derived(team !== null && proposable(answered, picks));

	/** Reads the answer for the picks, keeping only the latest; the last answer stays, quieter, while
	 * the next is read. */
	async function ask(): Promise<void> {
		const asked = picks;
		const input = checkInput(asked);
		problem = null;
		copied = null;
		shared = null;
		if (input === null) {
			answered = null;
			reading = false;
			void asking.choose(null);
			return;
		}
		reading = true;
		const outcome = await asking.choose(input);
		if (outcome.kind === 'overtaken') return;
		reading = false;
		// No change this week on a trade moving a player whose game has kicked off (Lane 85).
		if (outcome.kind === 'answer')
			answered = { picks: asked, check: heldCheck(outcome.answer, now) };
		if (outcome.kind === 'failed') {
			answered = null;
			problem = outcome.sentence;
		}
	}

	/** Another team: the last answer was for the last team, so it goes (review H1). */
	function choose(rosterId: number): void {
		answered = null;
		picks = { team: rosterId, give: picks.give, get: [] };
		void ask();
	}

	function tap(side: 'give' | 'get', hostId: string): void {
		picks = { ...picks, [side]: toggle(picks[side], hostId) };
		void ask();
	}

	/** One tap loads an idea into the ticks; the member changes it freely from there. */
	function load(preset: Preset): void {
		if (preset.picks.team !== picks.team) answered = null;
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
		if (team === null || answered === null || !live) return;
		copied = await propose(team, answered.check.trade);
	}

	async function shareTrade(): Promise<void> {
		if (team === null || answered === null || !live) return;
		const text = shareText(team, answered.check);
		shared = (await share(text)) ? ANALYZER_LINES.shared : TRADES.copyFailed;
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
	<!-- Made again as the verb comes live: before, it is a disabled button, after, a link that takes
	     its new tab. -->
	<span class="act" {@attach hostTab(live ? page : '')}>
		<Verb
			href={page === '' ? undefined : page}
			disabled={page === '' || !live}
			size={fill ? undefined : 'sm'}
			{fill}
			onclick={() => void press()}>{verb}</Verb
		>
	</span>
{/snippet}

{#snippet shareVerb()}
	<span class="share">
		{#if shared}<span class="said" role="status">{shared}</span>{/if}
		<Quiet size="sm" disabled={!live} onclick={() => void shareTrade()}
			>{ANALYZER_LINES.share}</Quiet
		>
	</span>
{/snippet}

{#snippet chooseTeam()}
	<span class="choose">
		<PickSelect
			label={BUILDER_LINES.team}
			value={picks.team === null ? '' : String(picks.team)}
			groups={teamGroups}
			onchange={(value: string) => {
				if (value !== '') choose(Number(value));
			}}
		/>
	</span>
{/snippet}

<section {id} class="builder" tabindex="-1" aria-label={BUILDER_LINES.open} {@attach takeFocus}>
	{#if places.length > 0}
		<!-- Our ideas: the best trade with each team in this league, a card of two lines (the team and
		     both gains, then the deal), the best three and the rest in place behind "N more". -->
		<div class="ideas" role="group" aria-label={ANALYZER_LINES.ideas}>
			<span class="ideas-head">{ANALYZER_LINES.ideas}</span>
			<ul id={IDEAS_ID} class:all={allIdeas} bind:this={ideaList}>
				{#each shownIdeas as place (place.kind === 'idea' ? place.preset.key : place.none.key)}
					{#if place.kind === 'none'}
						<!-- A team the finder lists no trade with: its line in its place, nothing to load. -->
						<li>
							<span class="no-idea" tabindex="-1"
								><span class="top"
									><span class="with">{TRADES.with} {place.none.team.name}</span></span
								><span class="deal">{place.none.note}</span></span
							>
						</li>
					{:else}
						{@const preset = place.preset}
						<li>
							<button
								type="button"
								class="idea"
								aria-pressed={samePicks(picks, preset.picks)}
								onclick={() => load(preset)}
							>
								<span class="top"
									>{#if preset.mark}<b class="mark">{preset.mark}</b>{/if}<span class="with"
										>{TRADES.with} {preset.team.name}</span
									><span class="gains">{preset.gains}</span></span
								><span class="deal">{preset.deal}</span>
							</button>
						</li>
					{/if}
				{/each}
				{#if hiddenIdeas > 0}
					<li>
						<button
							type="button"
							class="more"
							aria-expanded="false"
							aria-controls={IDEAS_ID}
							onclick={() => void showAllIdeas()}>{moreWords(hiddenIdeas)}</button
						>
					</li>
				{/if}
			</ul>
		</div>
	{/if}
	<!-- Where the rosters stack, one at a time: a tap between yours and theirs, never a scroll past
	     twenty rows (Lane 260 fix round 1). The ticks are the picks, so they hold across the switch. -->
	<div class="switch">
		<ChipGroup label={ANALYZER_LINES.rosters}>
			<Chip pressed={drawn === 'give'} onclick={() => (drawn = 'give')}
				>{ANALYZER_LINES.you}{countWords(picks.give)}</Chip
			>
			<Chip pressed={drawn === 'get'} onclick={() => (drawn = 'get')}
				>{team?.name ?? ANALYZER_LINES.pickTeam}{countWords(picks.get)}</Chip
			>
		</ChipGroup>
	</div>
	<div class="boxes">
		<div class="side" class:away={drawn !== 'give'}>
			<TradeBox
				team={me.name}
				mine
				aside={me.aside}
				holds={holdsWords('give')}
				lines={roster}
				pickOf={tickOf('give')}
				{now}
			/>
		</div>
		<div class="side" class:away={drawn !== 'get'}>
			<TradeBox
				team={team?.name ?? ''}
				aside={team ? teamAside(team) : ''}
				holds={team ? holdsWords('get') : ''}
				lines={team?.roster ?? []}
				pickOf={tickOf('get')}
				choose={chooseTeam}
				{now}
			/>
		</div>
	</div>
	<div class="verdict">
		<div class:reading>
			<TradeBug
				gainHead={TRADES.gainHead}
				restHead={TRADES.restHead}
				teamHead={ANALYZER_LINES.team}
				yours={{
					name: me.name,
					figures: bugFigures(
						answer?.totals.yours ?? null,
						answer?.trade.my_gain ?? null,
						answer?.trade.my_proj_change ?? null
					),
					room: room.yours,
					bar: bars.yours,
					rest: restFigure(answer, 'yours')
				}}
				theirs={{
					name: team?.name ?? '',
					figures: bugFigures(
						answer?.totals.theirs ?? null,
						answer?.trade.their_gain ?? null,
						answer?.trade.their_proj_change ?? null
					),
					room: room.theirs,
					bar: bars.theirs,
					rest: restFigure(answer, 'theirs')
				}}
			>
				{#snippet verb()}
					<span class="verbs">{@render shareVerb()}{@render action(false)}</span>
					{#if copied}<TradeCopied line={copied} href={page} />{/if}
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
	{#if moves.reason ?? hostNote}<p class="own">{moves.reason ?? hostNote}</p>{/if}
	<p class="own" data-basis="builder">
		{answer?.basis ?? basis}
		{#if answer?.rest_of_season_basis}<span class="rest-said">{answer.rest_of_season_basis}</span
			>{/if}
		<a href={basisHref}>{BUILDER_LINES.figures}</a>
	</p>
	<!-- Where the rosters stack the gains, Share and the verb are pinned to the window's foot (above the
	     tab bar on a phone), so each tap's answer stays in sight. -->
	<div class="pin">
		<span class="pin-gains" class:reading
			>{#if refusal}{refusal}{:else if answer && fillsBoth(answer)}<b
					>{gainWord(answer.trade.my_gain)}</b
				>
				{TRADES.aWeekForYou}, {gainWord(answer.trade.their_gain)}
				{TRADES.forTheirs}{:else}{sentence}{/if}</span
		>
		{@render shareVerb()}
		{@render action(true)}
		{#if copied}<span class="pin-said"><TradeCopied line={copied} href={page} /></span>{/if}
	</div>
</section>

<style>
	.builder {
		display: flex;
		flex-direction: column;
		gap: 4px;
		outline: none;
		scroll-margin: var(--s-4);
	}

	/* Our ideas: one row, the label then the best three cards of two lines each and "N more"; the
	   rest wrap in place under them once shown. Nothing in a card is ever cut. */
	.ideas {
		display: flex;
		align-items: flex-start;
		gap: var(--s-3);
		min-width: 0;
	}

	.ideas-head {
		flex: none;
		align-self: center;
		max-width: 6.5em;
		line-height: 1.3;
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
	}

	.ideas ul {
		flex: 1;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
		gap: var(--s-2);
		margin: 0;
		padding: 0;
		list-style: none;
		min-width: 0;
	}

	.ideas ul.all {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.ideas li {
		display: flex;
		min-width: 0;
	}

	.idea,
	.more {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		min-height: 38px;
		padding: 3px var(--s-3);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-size: var(--t-sm);
		text-align: left;
		cursor: pointer;
	}

	.idea {
		flex-direction: column;
		align-items: stretch;
		justify-content: center;
		gap: 0;
		overflow: hidden;
		line-height: 16px;
	}

	/* A team with no idea (B271): the card's two lines, quiet and flat, nothing to press. */
	.no-idea {
		display: flex;
		flex-direction: column;
		justify-content: center;
		width: 100%;
		min-height: 38px;
		padding: 3px var(--s-3);
		border: 1px dashed var(--line);
		border-radius: var(--r-md);
		font-size: var(--t-sm);
		line-height: 16px;
		overflow: hidden;
		color: var(--ink-2);
		outline: none;
	}

	.no-idea .deal {
		font-weight: 500;
	}

	.more {
		width: auto;
		white-space: nowrap;
		font-weight: 600;
		color: var(--accent-text);
	}

	.idea:hover,
	.more:hover {
		border-color: var(--line-strong);
	}

	.idea[aria-pressed='true'] {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent);
	}

	.idea:focus-visible,
	.more:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.mark {
		flex: none;
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--accent-text);
	}

	/* The first line, the team and both gains; a long one wraps, never cut. */
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 6px;
		font-size: var(--t-xs);
	}

	.deal {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.with {
		color: var(--ink-2);
	}

	.gains {
		margin-left: auto;
		font-size: var(--t-xs);
		font-variant-numeric: tabular-nums;
		color: var(--ink-2);
	}

	/* What the verdict's rest-of-season cells are and the rule a side takes a trade by (Lane 277),
	   under the cells; at a desk only, as the phone draws no cell (TradeBug). */
	@media (max-width: 760px) {
		.rest-said {
			display: none;
		}
	}

	.choose {
		flex: 1;
		min-width: 0;
		display: flex;
	}

	.choose :global(.pick) {
		flex: 1;
		font-size: var(--t-xs);
	}

	.choose :global(select) {
		flex: 1;
		height: 24px;
		max-width: 20rem;
		font-size: var(--t-sm);
		font-weight: 700;
	}

	.share {
		display: flex;
		align-items: center;
		gap: var(--s-2);
	}

	.said {
		font-size: var(--t-xs);
		color: var(--ink-2);
	}

	.verbs {
		display: flex;
		align-items: center;
		gap: var(--s-2);
	}

	.words {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--s-1) var(--s-3);
	}

	.line {
		margin: 0;
		font-size: var(--t-sm);
		font-weight: 500;
		line-height: 18px;
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

	/* The switch between the rosters shows only where they stack. */
	.switch {
		display: none;
	}

	/* The verdict under the rosters stays in sight at a desk as the ticks change, held to the foot of
	   the window. */
	.verdict {
		display: flex;
		flex-direction: column;
		gap: 2px;
		position: sticky;
		bottom: 0;
		z-index: 5;
		margin: 0 calc(var(--s-5) * -1);
		padding: 2px var(--s-5);
		background: var(--surface);
		border-top: 1px solid var(--line-strong);
		box-shadow: 0 -6px 16px -12px rgb(0 0 0 / 0.35);
	}

	.pin {
		display: none;
	}

	@media (max-width: 1180px) {
		/* Where three cards would not fit, the row scrolls sideways from the Best card; once every idea
		   shows, they wrap in place under it, the Best card first. */
		.ideas ul,
		.ideas ul.all {
			display: flex;
			overflow-x: auto;
			scroll-snap-type: x proximity;
			padding: 2px;
			margin: -2px;
		}

		.ideas ul.all {
			flex-wrap: wrap;
			overflow-x: visible;
		}

		.ideas li {
			flex: none;
			scroll-snap-align: start;
		}

		.idea {
			width: min(22rem, 86vw);
		}

		.boxes {
			grid-template-columns: minmax(0, 1fr);
		}

		.switch {
			display: flex;
		}

		.away {
			display: none;
		}

		/* The verdict stacks here: it sits under the rosters in its place, and the gains with Share and
		   the verb are pinned to the window's foot, so a tick on one roster reads its answer in sight
		   (Lane 260 fix round 2: the switch shows one roster from here down). */
		.verdict {
			position: static;
			margin: 0;
			padding: 0;
			border-top: 0;
			box-shadow: none;
		}

		.pin {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			justify-content: space-between;
			gap: var(--s-1) var(--s-2);
			position: sticky;
			bottom: env(safe-area-inset-bottom, 0px);
			z-index: 10;
			margin: 0 calc(var(--s-4) * -1) calc(var(--s-4) * -1);
			padding: var(--s-2) var(--s-3);
			background: var(--surface);
			border-top: 1px solid var(--line-strong);
			font-size: var(--t-xs);
		}

		.pin-gains {
			flex: 1;
			min-width: 0;
			color: var(--ink-2);
		}

		.pin-gains b {
			font-family: var(--font-num);
			font-size: var(--t-md);
			color: var(--gain-ink);
		}

		.pin-said {
			flex-basis: 100%;
		}
	}

	@media (max-width: 760px) {
		/* The label over the cards, which scroll sideways, each its one line. */
		.ideas {
			flex-direction: column;
			align-items: stretch;
			gap: 4px;
		}

		.ideas-head {
			align-self: flex-start;
			max-width: none;
			line-height: 1.3;
		}

		.choose :global(select) {
			max-width: none;
		}

		/* Above the tab bar on a phone. */
		.pin {
			bottom: calc(var(--tab-bar-h) + env(safe-area-inset-bottom, 0px));
		}
	}
</style>
