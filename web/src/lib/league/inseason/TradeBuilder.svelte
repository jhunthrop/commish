<script lang="ts">
	import { onMount } from 'svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import ToneChip from '#lib/ui/ToneChip.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import type { LeagueHost } from '../api.ts';
	import Basis from './Basis.svelte';
	import LineRow from './LineRow.svelte';
	import type { PlayerLine, TradeCheck, TradeCheckInput, TradeTeam } from './api.ts';
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
	import PickSelect from './PickSelect.svelte';
	import { focusOnOpen, hostTab } from './attach.ts';
	import { Narrowing } from './state.ts';
	import { CLOSE_FOR_THEM, verbWords } from './words.ts';

	/** The trade builder (Lane 61), in the move panel's shape: the other team chosen by name and
	 * record, your roster and theirs as rows, a tap picking up to two a side, and the answer line,
	 * read again as you pick, saying what each lineup gains or loses on the finder's own reckoning.
	 * The one verb is the host's trade page, the finder's; we never send an offer. */
	interface Props {
		id: string;
		/** Every other team, with its roster. */
		teams: readonly TradeTeam[];
		/** Your active roster. */
		roster: readonly PlayerLine[];
		host: LeagueHost;
		/** The picks it opens with: a finder row's trade, or a team alone. */
		start: Picks;
		/** The builder's honesty line, from the finder's answer, until the first check says it. */
		basis: string;
		/** The host's trade page and the API's note when it has none. */
		href: string;
		hostNote: string | null;
		check: (trade: TradeCheckInput) => Promise<TradeCheck>;
		onclose: () => void;
	}

	let { id, teams, roster, host, start, basis, href, hostNote, check, onclose }: Props = $props();

	// The panel is made again for each trade it opens with ({#key} in the screen).
	// svelte-ignore state_referenced_locally
	let picks = $state<Picks>(start);
	let answer = $state<TradeCheck | null>(null);
	let reading = $state(false);
	let problem = $state<string | null>(null);

	// svelte-ignore state_referenced_locally
	const asking = new Narrowing(check);

	const team = $derived(teams.find((t) => t.roster_id === picks.team) ?? null);
	const yours = $derived(roster.filter(pickable));
	const theirs = $derived((team?.roster ?? []).filter(pickable));
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
	const verb = $derived(verbWords('trades', host));
	const page = $derived(answer?.host_trades_url ?? href);

	/** Reads the answer for the picks, keeping only the latest; the last answer stays, quieter, while
	 * the next is read. */
	async function ask(): Promise<void> {
		const input = checkInput(picks);
		problem = null;
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
		if (outcome.kind === 'answer') answer = outcome.answer;
		if (outcome.kind === 'failed') {
			answer = null;
			problem = outcome.sentence;
		}
	}

	function choose(roster: number): void {
		picks = { team: roster, give: picks.give, get: [] };
		void ask();
	}

	function tap(side: 'give' | 'get', hostId: string): void {
		picks = { ...picks, [side]: toggle(picks[side], hostId) };
		void ask();
	}

	onMount(() => {
		if (checkInput(picks) !== null) void ask();
	});
</script>

{#snippet side(name: 'give' | 'get', label: string, lines: readonly PlayerLine[])}
	{@const picked = picks[name]}
	{@const full = picked.length >= MAX_A_SIDE}
	<section class="side" aria-label={label}>
		<h3>
			{label}{#if full}<span class="full">{BUILDER_LINES.full}</span>{/if}
		</h3>
		{#each lines as line (line.player.host_id)}
			{@const hostId = line.player.host_id}
			{@const on = picked.includes(hostId)}
			<button
				type="button"
				class="pick"
				class:on
				aria-pressed={on}
				disabled={!on && full}
				onclick={() => tap(name, hostId)}
			>
				<LineRow line={{ ...line, slug: null }} />
			</button>
		{/each}
	</section>
{/snippet}

<div {id} class="builder" tabindex="-1" {@attach focusOnOpen}>
	<Panel as="section" label={BUILDER_LINES.open} edge="accent">
		<div class="body">
			<PickSelect
				label={BUILDER_LINES.team}
				value={picks.team ?? ''}
				onchange={(value: string) => choose(Number(value))}
			>
				{#each teams as t (t.roster_id)}
					<option value={t.roster_id}>{teamChoice(t)}</option>
				{/each}
			</PickSelect>
			<div class="answer">
				<div class="words" aria-live="polite" aria-busy={reading}>
					{#if problem}
						<ProblemLine>{problem}</ProblemLine>
					{:else}
						<p class="line" class:quiet={answer === null} class:reading>{sentence}</p>
					{/if}
					{#if close}<ToneChip tone="even">{CLOSE_FOR_THEM}</ToneChip>{/if}
				</div>
				<div class="actions" {@attach hostTab(page)}>
					<Verb href={page} disabled={page === ''}>{verb}</Verb>
					<Quiet onclick={onclose}>{BUILDER_LINES.notNow}</Quiet>
				</div>
				{#if hostNote}<p class="note">{hostNote}</p>{/if}
			</div>
			<Basis basis={answer?.basis ?? basis} />
			<div class="sides">
				{@render side('give', BUILDER_LINES.give, yours)}
				{@render side('get', BUILDER_LINES.get, theirs)}
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

	.answer {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	.words {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--s-2) var(--s-3);
	}

	.line {
		margin: 0;
		max-width: 72ch;
		font-size: var(--t-md);
		font-weight: 600;
		line-height: 1.4;
	}

	.quiet {
		color: var(--ink-2);
		font-weight: 400;
	}

	/* While the next answer is read, the last one stays, quieter. */
	.reading {
		opacity: 0.6;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2);
	}

	.note {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--t-sm);
	}

	/* Your roster beside theirs at a desk's width, each row a tap. */
	.sides {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--s-4);
		margin: 0 calc(var(--s-4) * -1) calc(var(--s-4) * -1);
	}

	.side {
		min-width: 0;
	}

	h3 {
		margin: 0;
		padding: var(--s-2) var(--s-3);
		font-size: var(--t-sm);
		font-weight: 700;
		color: var(--ink-2);
		border-bottom: 1px solid var(--line-strong);
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--s-1) var(--s-3);
	}

	/* A side holding two says why its other rows wait, in words a phone shows. */
	.full {
		font-weight: 400;
		color: var(--ink-2);
	}

	.pick {
		display: block;
		width: 100%;
		padding: 0;
		border: 0;
		border-left: 3px solid transparent;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.pick:hover:not(:disabled) {
		background: var(--surface-2);
	}

	.pick.on {
		border-left-color: var(--accent);
		background: var(--accent-wash);
	}

	.pick:disabled {
		cursor: default;
		opacity: 0.55;
	}

	.pick:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	/* On a phone the two rosters stack, and the answer with its verb is pinned where the screen's verb
	   was, so each tap's answer is in sight. */
	@media (max-width: 760px) {
		.sides {
			grid-template-columns: minmax(0, 1fr);
			margin-bottom: 0;
		}

		.answer {
			position: sticky;
			bottom: calc(var(--tab-bar-h) + env(safe-area-inset-bottom, 0px));
			z-index: 10;
			order: 1;
			margin: 0 calc(var(--s-4) * -1) calc(var(--s-4) * -1);
			padding: var(--s-3) var(--s-4);
			background: var(--surface);
			border-top: 1px solid var(--line-strong);
		}
	}
</style>
