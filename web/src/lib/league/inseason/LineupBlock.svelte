<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { memberZone } from '#lib/format/clock.ts';
	import { LEAGUE_HOME } from '#lib/ui/nav.ts';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import type { AttachedLeague } from '../api.ts';
	import { POLL_MS, followedName, readAgoLine, standingWords } from '../model.ts';
	import { inSeasonApi, type HostMoveInput, type LineupAdvice } from './api.ts';
	import { EVERY, lineupBlock, type BlockReport } from './every-lineup.ts';
	import { LineupMover } from './lineup-mover.svelte.ts';
	import StartScreen from './StartScreen.svelte';
	import { readFailure } from './state.ts';
	import { leagueScreens } from './tab-list.ts';
	import { tabHref } from './tabs.ts';
	import { LINES, refreshedWords } from './words.ts';

	/** One league on the every-league page (Lane 257): its name and the member's team as the head, its
	 * own read and order stamps, and its Lineup as its own screen draws it, the same table, words and
	 * verb, read through the same route on the page's own clock for this league. A league with nothing
	 * to change, a week done, a lineup it has none of in its phase, or a read the API refused is one
	 * line with the way to its own screen. Read on open and once a minute, as its own screen is. */
	interface Props {
		league: AttachedLeague;
		/** The page's verb drives this league's move with the others: its panel has no verb of its own. */
		held: boolean;
		/** What this block is now, for the page's head and its verb: the move entry when the page's verb
		 * makes this league's changes. */
		onstate: (report: BlockReport) => void;
		/** The account's session lapsed: the page asks to sign in again. */
		onsignedout: () => void;
	}

	let { league, held, onstate, onsignedout }: Props = $props();

	// The block is keyed by its league in the page, so its league is fixed for its life.
	// svelte-ignore state_referenced_locally
	const { id } = league;
	const zone = memberZone();
	const hasLineup = $derived(leagueScreens(league).includes('start'));

	let advice = $state<LineupAdvice | null>(null);
	/** The clock the lineup is drawn at: set at each read, drawn only once one has landed. */
	let now = $state(0);
	let refusal = $state<string | null>(null);
	let problem = $state<string | null>(null);

	async function read(): Promise<void> {
		try {
			advice = await inSeasonApi.lineup(id);
			now = Date.now();
			refusal = null;
			problem = null;
		} catch (error) {
			const failure = readFailure(error, advice !== null);
			if (failure.kind === 'signed-out') onsignedout();
			else if (failure.kind === 'stale') problem = failure.sentence;
			else refusal = failure.sentence;
		}
	}

	const mover = new LineupMover({
		plan: (move: HostMoveInput) => inSeasonApi.planMove(id, move),
		make: (move: HostMoveInput, confirm: string) => inSeasonApi.makeMove(id, move, confirm),
		reread: () => void read()
	});

	onMount(() => {
		if (!hasLineup) return;
		void read();
		const timer = setInterval(() => void read(), POLL_MS);
		return () => clearInterval(timer);
	});

	const block = $derived(advice === null ? null : lineupBlock(advice, now, zone));
	/** The table stays while its move's panel is open, so what the move came to is said in place even
	 * once the lineup it set reads as set. */
	const drawn = $derived(
		block !== null &&
			(block.kind === 'here' || block.kind === 'elsewhere' || mover.step.kind !== 'closed')
	);

	$effect(() => {
		const kind: BlockReport['kind'] = !hasLineup
			? 'none'
			: refusal !== null
				? 'refused'
				: (block?.kind ?? 'reading');
		const changes = block && 'changes' in block ? block.changes : 0;
		const entry =
			block?.kind === 'here' && advice !== null
				? { id, mover, advice, now, host: league.host }
				: null;
		// Said to the page without reading what the page keeps, so its keeping never runs this again.
		untrack(() => onstate({ id, kind, changes, entry }));
	});

	const name = $derived(followedName(league));
	const team = $derived(
		league.standing ? `${league.team_name}, ${standingWords(league)}.` : league.team_name
	);
	const lineupHref = $derived(tabHref('start', id));
</script>

<section class="block" aria-label={name}>
	<header class="head">
		<h2 class="name"><a href={hasLineup ? lineupHref : tabHref(LEAGUE_HOME, id)}>{name}</a></h2>
		<p class="sub">
			<span class="team">{team}</span>
			{#if advice}
				<span class="read"
					>{readAgoLine(league.host, advice.read_at, new Date(now))}
					{refreshedWords(advice.order_basis, advice.refreshed)}</span
				>
			{/if}
		</p>
	</header>
	{#if !hasLineup}
		<p class="line">
			<span>{EVERY.noLineup}</span>
			<Quiet size="sm" href={tabHref(LEAGUE_HOME, id)}>{EVERY.openLeague}</Quiet>
		</p>
	{:else if refusal !== null}
		<p class="line">
			<ProblemLine>{refusal}</ProblemLine>
			<Quiet size="sm" href={lineupHref}>{EVERY.open}</Quiet>
		</p>
	{:else if advice === null || block === null}
		<div class="reserve" aria-busy="true" aria-label={LINES.reading}>
			<div class="call"></div>
			<div class="row"></div>
			<div class="row"></div>
			<div class="row"></div>
		</div>
	{:else if drawn}
		{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
		<div class="screen">
			<StartScreen
				{advice}
				{now}
				host={league.host}
				league={id}
				scope={id}
				{mover}
				{held}
				pin={block.kind !== 'here' && mover.step.kind === 'closed'}
			/>
		</div>
	{:else}
		<p class="line">
			<span class="said">{block.kind === 'done' ? block.line : EVERY.set}</span>
			<Quiet size="sm" href={lineupHref}>{EVERY.open}</Quiet>
		</p>
	{/if}
</section>

<style>
	.block {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		padding-top: var(--s-4);
		border-top: 1px solid var(--line-strong);
	}

	.head {
		min-width: 0;
	}

	.name {
		margin: 0;
		font-size: var(--t-lg);
		font-weight: 700;
		line-height: 1.25;
	}

	.name a {
		color: var(--ink);
		text-decoration: none;
	}

	.name a:hover {
		text-decoration: underline;
	}

	.sub {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--s-3);
		margin: 2px 0 0;
		color: var(--ink-2);
		font-size: var(--t-sm);
	}

	.read {
		color: var(--ink-3);
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-2) var(--s-3);
		margin: 0;
	}

	.said {
		font-weight: 600;
	}

	/* The screen's parts sit in the block's own column, as its page's column holds them. */
	.screen {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}

	.reserve {
		display: flex;
		flex-direction: column;
	}

	.reserve .call {
		height: 74px;
		margin-bottom: var(--s-4);
		border-radius: var(--r-md);
		background: var(--surface);
	}

	.reserve .row {
		height: calc(var(--row-h) + 1px);
		border-bottom: 1px solid var(--line);
		background: var(--surface);
	}

	@media (max-width: 760px) {
		.screen {
			gap: var(--s-3);
		}
	}
</style>
