<script lang="ts">
	import BugCard from '../box/BugCard.svelte';
	import { HOME, type Bug } from './home.ts';

	/** The week's scoreboard (Lane 66i): every game as a score bug (BugCard) on the lit board, three
	 * across on a desk and swiped in a hand, the drafter's first with its orange rim. Each bug opens
	 * the Matchup. */
	interface Props {
		week: number;
		bugs: readonly Bug[];
		matchupHref: string;
		/** "Last read 3:05 pm" when the latest read failed and the board shows the last good one. */
		stamp?: string | null;
	}

	let { week, bugs, matchupHref, stamp = null }: Props = $props();
</script>

<section class="board" aria-label="{HOME.week} {week}">
	<div class="head">
		<h2>{HOME.week} {week}</h2>
		<span>{HOME.scoreboardAside}</span>
		{#if stamp}<span class="stamp" role="status">{stamp}</span>{/if}
	</div>
	<ul class="bugs">
		{#each bugs as bug (bug.key)}
			<li><BugCard {bug} href={matchupHref} /></li>
		{/each}
	</ul>
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

		.bugs li {
			flex: 0 0 300px;
			scroll-snap-align: start;
		}
	}
</style>
