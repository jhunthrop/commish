<script lang="ts">
	import BugCard from '../box/BugCard.svelte';
	import { bugRoster, gameHref } from '../box/game.ts';
	import { HOME, type Bug } from './home.ts';
	import type { GapFigure } from './figures.ts';

	/** The week's scoreboard (Lane 66i): every game as a score bug (BugCard) on the lit board, three
	 * across on a desk and swiped in a hand, the drafter's first with its orange rim. Each bug opens
	 * its own game on the Matchup (Lane 204): the drafter's the plain address, another team's with
	 * its roster. */
	interface Props {
		week: number;
		bugs: readonly Bug[];
		/** The Matchup's plain address, the drafter's own game. */
		matchupHref: string;
		/** "Last read 3:05 pm" when the latest read failed and the board shows the last good one. */
		stamp?: string | null;
		/** The drafter's game's Proj gap before its kickoff (Lane 292), drawn on their bug with its
		 * sentence under the board; null draws neither. */
		gap?: GapFigure | null;
	}

	let { week, bugs, matchupHref, stamp = null, gap = null }: Props = $props();
</script>

{#snippet gapFoot()}<span class="gap" data-figure="gap">{gap?.cell}</span>{/snippet}

<section class="board" aria-label="{HOME.week} {week}">
	<div class="head">
		<h2>{HOME.week} {week}</h2>
		<span>{HOME.scoreboardAside}</span>
		{#if stamp}<span class="stamp" role="status">{stamp}</span>{/if}
	</div>
	<ul class="bugs">
		{#each bugs as bug (bug.key)}
			<li>
				<BugCard
					{bug}
					href={gameHref(matchupHref, bugRoster(bug))}
					foot={bug.mine && gap ? gapFoot : undefined}
				/>
			</li>
		{/each}
	</ul>
	{#if gap}<p class="basis" data-basis="gap">{gap.basis}</p>{/if}
</section>

<style>
	.head {
		display: flex;
		align-items: baseline;
		gap: var(--s-3);
		margin: 0 0 var(--s-2);
	}

	h2 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-xl);
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.head span {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.head .stamp {
		margin-left: auto;
	}

	.gap {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: var(--scoreboard-ink);
	}

	.basis {
		margin: var(--s-2) 0 0;
		font-size: var(--t-sm);
		color: var(--ink-3);
		line-height: 1.5;
	}

	.bugs {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--s-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	@media (max-width: 1100px) {
		.bugs {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	/* In a hand the bugs swipe sideways, yours first, so they never push the standings down far. */
	@media (max-width: 760px) {
		.bugs {
			display: flex;
			overflow-x: auto;
			scroll-snap-type: x mandatory;
			scrollbar-width: none;
		}

		.basis {
			font-size: var(--t-xs);
			line-height: 1.45;
		}

		.bugs li {
			flex: 0 0 300px;
			scroll-snap-align: start;
		}
	}
</style>
