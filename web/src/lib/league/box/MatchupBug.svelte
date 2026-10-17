<script lang="ts">
	import { BOX, boxNumber } from './box.ts';
	import TeamAvatar from './TeamAvatar.svelte';

	/** The matchup's score bug (Lane 66d): both teams with their avatars and their points so far on
	 * the lit board, each with its projection under, the week and the next kickoff between them. The
	 * drafter's side in the accent. A side we hold no opponent for is left out. */
	interface Side {
		name: string;
		pts: number | null;
		proj: number | null;
	}

	interface Props {
		week: number;
		mine: Side;
		opponent: Side | null;
		kickoff: { head: string; words: string } | null;
	}

	let { week, mine, opponent, kickoff }: Props = $props();
</script>

{#snippet side(s: Side, me: boolean)}
	<div class="sd" class:me>
		<span class="avatar"><TeamAvatar name={s.name} size={44} {me} board /></span>
		<span class="nm"><small>{me ? BOX.you : BOX.opponent}</small><b>{s.name}</b></span>
		<span class="sc">
			<b class="big" aria-label="{BOX.pts} {boxNumber(s.pts)}">{boxNumber(s.pts)}</b>
			<small>{BOX.proj} {boxNumber(s.proj)}</small>
		</span>
	</div>
{/snippet}

<section class="bug" class:alone={opponent === null} aria-label="Week {week} score">
	{@render side(mine, true)}
	<div class="mid">
		<small>Week {week}</small>
		{#if kickoff}<b>{kickoff.head}</b><span>{kickoff.words}</span>{/if}
	</div>
	{#if opponent}{@render side(opponent, false)}{/if}
</section>

<style>
	.bug {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: stretch;
		border-radius: var(--r-md);
		overflow: hidden;
		background: var(--scoreboard);
		color: var(--scoreboard-ink);
		border: 1px solid var(--scoreboard-line);
	}

	.alone {
		grid-template-columns: minmax(0, 1fr) auto;
	}

	.sd {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		padding: var(--s-3) var(--s-4);
		min-width: 0;
	}

	/* The opponent reads from the right edge in: score by the middle, name, then avatar. */
	.sd:not(.me) {
		flex-direction: row-reverse;
		text-align: right;
	}

	.nm {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.sd:not(.me) .nm {
		align-items: flex-end;
	}

	small {
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--scoreboard-ink-2);
	}

	.nm b {
		font-size: var(--t-lg);
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	.sc {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0 var(--s-2);
	}

	.big {
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-2xl);
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.me .big {
		color: var(--scoreboard-num);
	}

	.sc small {
		font-family: var(--font-num);
		font-size: var(--t-sm);
		text-transform: none;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
	}

	.avatar {
		display: inline-grid;
		flex: none;
	}

	.mid {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		padding: var(--s-2) var(--s-5);
		background: var(--scoreboard-2);
		border-inline: 1px solid var(--scoreboard-line);
		text-align: center;
	}

	.mid b {
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-lg);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.mid span {
		font-size: var(--t-sm);
		color: var(--scoreboard-ink-2);
		white-space: nowrap;
	}

	@media (max-width: 760px) {
		.bug,
		.alone {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}

		.mid {
			grid-column: 1 / -1;
			grid-row: 1;
			flex-direction: row;
			flex-wrap: wrap;
			justify-content: center;
			gap: var(--s-2);
			padding: 6px var(--s-3);
			border-inline: 0;
			border-bottom: 1px solid var(--scoreboard-line);
		}

		.mid span {
			font-size: var(--t-xs);
		}

		.sd,
		.sd:not(.me) {
			flex-direction: column;
			align-items: flex-start;
			gap: var(--s-1);
			padding: var(--s-2) var(--s-3);
		}

		.sd:not(.me) {
			align-items: flex-end;
			border-left: 1px solid var(--scoreboard-line);
		}

		.avatar {
			display: none;
		}

		.nm b {
			font-size: var(--t-sm);
		}

		.sc {
			flex-direction: row;
			align-items: baseline;
			gap: var(--s-2);
			padding: 0;
		}

		.big {
			font-size: var(--t-head);
		}
	}
</style>
