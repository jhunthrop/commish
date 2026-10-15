<script lang="ts">
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import ValueCell from '#lib/ui/ValueCell.svelte';
	import type { LeagueHost } from '../api.ts';
	import type { LeagueBoard } from '../board.ts';
	import LineRow from './LineRow.svelte';
	import Screen from './Screen.svelte';
	import type { WaiverAdvice, WaiverPosition, WaiverRow } from './api.ts';
	import { Narrowing } from './state.ts';
	import {
		GAIN_DECIMALS,
		LINES,
		NO_START_RULE,
		addsTitle,
		dropWords,
		startingCount,
		verbWords,
		waiverDecision
	} from './words.ts';

	/** Waivers (spec §5): the unrostered players ranked by what they add to this lineup, each with
	 * the player it costs least to drop for him, a position at a time if you like (read again for
	 * that position, so it is never cut to the first rows of every position). Add marks the pair as
	 * the decision, and the one verb opens the host's waiver page to claim it. */
	interface Props {
		advice: WaiverAdvice;
		board: LeagueBoard;
		host: LeagueHost;
		/** Reads the adds at one position. */
		narrow: (position: WaiverPosition) => Promise<WaiverAdvice>;
	}

	let { advice, board, host, narrow }: Props = $props();

	/** The positions the route narrows to, in the board's order. */
	const POSITIONS: readonly WaiverPosition[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

	let position = $state<WaiverPosition | null>(null);
	/** The answer for the chosen position, null for every position or until it is read. */
	let narrowed = $state<WaiverAdvice | null>(null);
	let reading = $state(false);
	let problem = $state<string | null>(null);
	/** The add the member marked, by his host id; null keeps the best add as the decision. */
	let marked = $state<string | null>(null);

	const idOf = (row: WaiverRow): string => row.add.player.host_id;
	const positions = $derived(
		POSITIONS.filter((p) => advice.rows.some((r) => r.add.player.position === p))
	);
	const shown = $derived(narrowed ?? advice);
	/** The rows of the chosen position: the narrowed answer's, or this answer's own while it is read. */
	const visible = $derived(
		position === null || narrowed !== null
			? shown.rows
			: advice.rows.filter((r) => r.add.player.position === position)
	);
	const gaining = $derived(visible.filter((r) => r.gain > 0));
	const rest = $derived(visible.filter((r) => r.gain <= 0));
	const chosen = $derived(visible.find((r) => idOf(r) === marked) ?? shown.best);

	// The route's reader is fixed for the page's life.
	// svelte-ignore state_referenced_locally
	const narrowing = new Narrowing(narrow);

	async function choose(next: WaiverPosition | null): Promise<void> {
		position = next;
		narrowed = null;
		problem = null;
		reading = next !== null;
		const outcome = await narrowing.choose(next);
		if (outcome.kind === 'overtaken') return;
		reading = false;
		if (outcome.kind === 'answer') narrowed = outcome.answer;
		if (outcome.kind === 'failed') problem = outcome.sentence;
	}
</script>

{#snippet row(r: WaiverRow)}
	{@const on = marked === idOf(r)}
	<div class="pick" class:on>
		<LineRow line={r.add} {board} note={dropWords(r)} brief>
			{#snippet trailing()}
				<span class="end">
					{#if r.gain > 0}
						<ValueCell value={r.gain} label={LINES.aWeek} signed decimals={GAIN_DECIMALS} />
					{/if}
					<span class="mark">
						<Quiet size="sm" onclick={() => (marked = on ? null : idOf(r))}
							>{on ? LINES.chosen : LINES.add}</Quiet
						>
					</span>
				</span>
			{/snippet}
		</LineRow>
	</div>
{/snippet}

<Screen
	decision={waiverDecision(chosen)}
	reason={chosen?.sentence}
	verb={verbWords('waivers', host)}
	href={shown.host_waivers_url}
	basis={shown.basis}
>
	<Panel as="section" label={LINES.waiverAdds} padding="none">
		<div class="head">
			<PanelHead title={addsTitle(advice.week)} aside={startingCount(gaining.length)} level={2} />
			<ChipGroup label={LINES.position}>
				<Chip size="sm" pressed={position === null} onclick={() => void choose(null)}
					>{LINES.all}</Chip
				>
				{#each positions as p (p)}
					<Chip size="sm" pressed={position === p} onclick={() => void choose(p)}>{p}</Chip>
				{/each}
			</ChipGroup>
			{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
		</div>
		<div class="rows" class:reading aria-busy={reading}>
			{#each gaining as r (idOf(r))}{@render row(r)}{/each}
			{#if rest.length > 0}
				<p class="rule">{NO_START_RULE}</p>
				{#each rest as r (idOf(r))}{@render row(r)}{/each}
			{/if}
		</div>
	</Panel>
</Screen>

<style>
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		padding: var(--s-3);
	}

	/* While a position is read, its rows from the last answer stay, quieter. */
	.reading {
		opacity: 0.6;
	}

	.pick.on {
		background: var(--accent-wash);
	}

	.end {
		display: flex;
		align-items: center;
		gap: var(--s-3);
	}

	/* The row's link covers it; the mark sits above so a tap on it marks rather than opens. */
	.mark {
		position: relative;
		z-index: 1;
	}

	.rule {
		margin: 0;
		padding: var(--s-3) var(--s-3) var(--s-2);
		border-top: 2px solid var(--line-strong);
		color: var(--ink-2);
		font-size: var(--t-sm);
		font-weight: 600;
	}
</style>
