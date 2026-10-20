<script lang="ts">
	import { BOX } from './box.ts';
	import { bugFigures, type BugTotals } from './matchup.ts';
	import TeamAvatar from './TeamAvatar.svelte';

	/** The matchup's score bug (Lane 66d): both teams with their avatars on the lit board, each with
	 * its big figure and its small one under (Lane 92: before the first kickoff its Proj, from it its
	 * Pts with its projected final under), the week, the game's state and the read beside the live
	 * score between them, and under the two scores the API's line on where the member stands (Lane 99,
	 * B31). The drafter's side in the accent. A side we hold no opponent for is left out. */
	interface Side extends BugTotals {
		name: string;
	}

	interface Props {
		week: number;
		mine: Side;
		opponent: Side | null;
		kickoff: { head: string; words: string } | null;
		/** The game has kicked off: the Pts are the big figures. */
		started: boolean;
		/** "ESPN 1 min ago" beside a live score, null before kickoff and once final. */
		read: string | null;
		/** "Down 14.1 with nobody left; they have McCaffrey and Kittle playing", the API's, null before
		 * kickoff or without one. */
		standing?: string | null;
	}

	let { week, mine, opponent, kickoff, started, read, standing = null }: Props = $props();
</script>

{#snippet side(s: Side, me: boolean)}
	{@const f = bugFigures(s, started)}
	<div class="sd" class:me>
		<span class="avatar"><TeamAvatar name={s.name} size={44} {me} board /></span>
		<span class="nm"
			><small>{me ? BOX.you : BOX.opponent}</small><b>{s.name}</b>{#if s.toPlay}<span class="tp"
					>{s.toPlay}</span
				>{/if}</span
		>
		<span class="sc">
			<b class="big" aria-label="{f.bigLabel} {f.big}">{f.big}</b>
			{#if f.small}<small>{f.small}</small>{/if}
		</span>
	</div>
{/snippet}

<section class="bug" class:alone={opponent === null} aria-label="Week {week} score">
	{@render side(mine, true)}
	<div class="mid">
		<small>Week {week}</small>
		{#if kickoff}<b>{kickoff.head}</b><span>{kickoff.words}</span>{/if}
		{#if read}<span class="read">{read}</span>{/if}
	</div>
	{#if opponent}{@render side(opponent, false)}{/if}
	{#if standing}<p class="standing">{standing}</p>{/if}
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

	/* Where the side's starters stand while the game is under way, under its name (fix round 1). */
	.nm .tp {
		font-size: var(--t-xs);
		font-weight: 600;
		color: var(--scoreboard-num);
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

	/* Where the member stands, across the board under the two scores (Lane 99, B31). */
	.standing {
		grid-column: 1 / -1;
		margin: 0;
		padding: var(--s-2) var(--s-4);
		border-top: 1px solid var(--scoreboard-line);
		text-align: center;
		font-size: var(--t-md);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	/* The read beside the live score: a cell, lit, not the grey line under the league's name. */
	.mid .read {
		color: var(--scoreboard-ink);
		font-variant-numeric: tabular-nums;
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

		.standing {
			padding: 6px var(--s-3);
			font-size: var(--t-sm);
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
