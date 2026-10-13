<script lang="ts">
	import NameWords from '#lib/ui/NameWords.svelte';
	import Face from '#lib/ui/Face.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import type { MockReport } from '../api.ts';
	import type { Board } from '../model.ts';

	interface Props {
		runs: MockReport['runs'];
		board: Board;
		seat: number;
		/** Whose runs: your own, or a shared draft's drafter. */
		whose?: 'your' | 'their';
	}

	let { runs, board, seat, whose = 'your' }: Props = $props();

	const who = $derived(whose === 'your' ? 'you' : 'they');

	/** Rows listed: the players you land most. */
	const ROWS = 8;
</script>

<Panel>
	<h3>Who {who} end up with<span>share of {runs.runs} runs</span></h3>
	<div class="expo">
		{#each runs.exposure.slice(0, ROWS) as e (e.player_id)}
			{@const player = board.byId.get(e.player_id)}
			{#if player}
				<div class="e">
					<Face src={player.headshot} name={player.name} size={32} />
					<b
						><NameWords name={player.name} />
						<span>{player.position} {player.positionRank}</span></b
					>
					<span class="bar"><i style:width="{e.share * 100}%"></i></span>
					<span class="pct">{Math.round(e.share * 100)}%</span>
				</div>
			{/if}
		{/each}
	</div>
	<p class="need">
		Every player {who} land in more than half the runs from slot {seat} is a player to know cold.
	</p>
</Panel>

<style>
	h3 {
		margin: 0 0 var(--s-3);
		font-size: var(--t-md);
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	h3 span {
		font-size: var(--t-xs);
		color: var(--ink-3);
		font-weight: 500;
	}

	.expo {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.e {
		display: grid;
		/* The name takes the room the bar gives up, and wraps rather than losing its end. */
		grid-template-columns: 32px minmax(0, 1fr) 64px 48px;
		gap: var(--s-2);
		align-items: center;
		font-size: var(--t-sm);
	}

	.e b {
		font-weight: 600;
		line-height: 1.25;
	}

	.e b span {
		font-size: var(--t-xs);
		font-weight: 500;
		color: var(--ink-3);
	}

	.bar {
		height: 8px;
		background: var(--surface-2);
		border-radius: 3px;
		overflow: hidden;
	}

	.bar i {
		display: block;
		height: 100%;
		background: var(--ink-2);
	}

	.pct {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-lg);
		text-align: right;
	}

	.need {
		margin: var(--s-3) 0 0;
		padding-top: var(--s-3);
		border-top: 1px solid var(--line);
		font-size: var(--t-sm);
		color: var(--ink-2);
	}
</style>
