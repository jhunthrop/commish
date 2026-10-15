<script lang="ts">
	import { count } from '#lib/format/number.ts';
	import { POSITIONS, type Position } from '#lib/types/player.ts';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import ValueCell from '#lib/ui/ValueCell.svelte';
	import type { LeagueHost } from '../api.ts';
	import type { LeagueBoard } from '../board.ts';
	import LineRow from './LineRow.svelte';
	import Screen from './Screen.svelte';
	import type { WaiverAdvice, WaiverRow } from './types.ts';
	import { GAIN_DECIMALS, NO_START_RULE, dropWords, verbWords, waiverDecision } from './words.ts';

	/** Waivers (spec §5): the unrostered players ranked by what they add to this lineup, each with
	 * the player it costs least to drop for him, a position at a time if you like. Add marks the
	 * pair as the decision, and the one verb opens the host's waiver page to claim it. */
	interface Props {
		advice: WaiverAdvice;
		board: LeagueBoard;
		host: LeagueHost;
	}

	let { advice, board, host }: Props = $props();

	let position = $state<Position | null>(null);
	/** The add the member marked, by his host id; null keeps the best add as the decision. */
	let marked = $state<string | null>(null);

	const idOf = (row: WaiverRow): string => row.add.player.host_id;
	const positions = $derived(
		POSITIONS.filter((p) => advice.rows.some((r) => r.add.player.position === p))
	);
	const visible = $derived(
		position === null ? advice.rows : advice.rows.filter((r) => r.add.player.position === position)
	);
	const gaining = $derived(visible.filter((r) => r.gain > 0));
	const rest = $derived(visible.filter((r) => r.gain <= 0));
	const chosen = $derived(advice.rows.find((r) => idOf(r) === marked) ?? advice.best);
</script>

{#snippet row(r: WaiverRow)}
	{@const on = marked === idOf(r)}
	<div class="pick" class:on>
		<LineRow line={r.add} {board} note={dropWords(r)}>
			{#snippet trailing()}
				<span class="end">
					{#if r.gain > 0}
						<ValueCell value={r.gain} label="a week" signed decimals={GAIN_DECIMALS} />
					{/if}
					<span class="mark">
						<Quiet size="sm" onclick={() => (marked = on ? null : idOf(r))}
							>{on ? 'Chosen' : 'Add'}</Quiet
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
	href={advice.host_waivers_url}
	basis={advice.basis}
>
	<Panel as="section" label="Waiver adds" padding="none">
		<div class="head">
			<PanelHead
				title={`Adds for week ${String(advice.week)}`}
				aside={`${count(gaining.length)} start for you`}
				level={2}
			/>
			<ChipGroup label="Position">
				<Chip size="sm" pressed={position === null} onclick={() => (position = null)}>All</Chip>
				{#each positions as p (p)}
					<Chip size="sm" pressed={position === p} onclick={() => (position = p)}>{p}</Chip>
				{/each}
			</ChipGroup>
		</div>
		{#each gaining as r (idOf(r))}{@render row(r)}{/each}
		{#if rest.length > 0}
			<p class="rule">{NO_START_RULE}</p>
			{#each rest as r (idOf(r))}{@render row(r)}{/each}
		{/if}
	</Panel>
</Screen>

<style>
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		padding: var(--s-3);
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
