<script lang="ts">
	import TeamAvatar from '../box/TeamAvatar.svelte';
	import { BOX } from '../box/box.ts';
	import { HOME, type Bug } from './home.ts';

	/** The week's scoreboard (Lane 66i): every game as a score bug pair on the lit board, three across
	 * on a desk and swiped in a hand, the drafter's first with its orange rim. Each bug names the
	 * state (the next kickoff, in play, final) and each side its record, projection and points so far.
	 * Once a game has started the side ahead is bright and the side behind muted; before kickoff both
	 * read alike. Each bug opens the Matchup. */
	interface Props {
		week: number;
		bugs: readonly Bug[];
		matchupHref: string;
	}

	let { week, bugs, matchupHref }: Props = $props();
</script>

<section class="board" aria-label="{HOME.week} {week}">
	<div class="head">
		<h2>{HOME.week} {week}</h2>
		<span>{HOME.scoreboardAside}</span>
	</div>
	<ul class="bugs">
		{#each bugs as bug (bug.key)}
			<li>
				<a class="bug" class:mine={bug.mine} href={matchupHref}>
					<span class="bh">
						<span class="st" class:live={bug.state === 'playing'}
							>{#if bug.state === 'playing'}<span class="pulse" aria-hidden="true"
								></span>{/if}{bug.head}</span
						>
						<span class="sw">{bug.words}</span>
						<span class="n">{BOX.proj}</span>
						<span class="n">{BOX.pts}</span>
					</span>
					{#each bug.sides as side (side.rosterId)}
						<span class="bt {side.stands}" class:me={side.me}>
							<TeamAvatar name={side.name} size={26} me={side.me} board src={side.avatar} />
							<span class="nm">{side.name}</span>
							<span class="rec">{side.record}</span>
							<span class="proj">{side.proj}</span>
							<span class="pts">{side.pts}</span>
						</span>
					{/each}
				</a>
			</li>
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

	.bugs {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--s-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.bug {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--s-2) var(--s-3) var(--s-3);
		border-radius: var(--r-md);
		background: var(--scoreboard);
		color: var(--scoreboard-ink);
		border: 1px solid var(--scoreboard-line);
		text-decoration: none;
	}

	.bug:hover {
		border-color: var(--scoreboard-ink-2);
	}

	.bug.mine {
		box-shadow: inset 0 3px 0 var(--scoreboard-num);
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--scoreboard-num) 14%, var(--scoreboard)) 0,
			var(--scoreboard) 70%
		);
	}

	.bh,
	.bt {
		display: grid;
		grid-template-columns: 26px minmax(0, 1fr) auto 52px 60px;
		align-items: center;
		column-gap: var(--s-2);
	}

	.bh {
		grid-template-columns: auto minmax(0, 1fr) 52px 60px;
		min-height: 24px;
		font-size: var(--t-xs);
		color: var(--scoreboard-ink-2);
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		font-weight: 600;
	}

	.st {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--scoreboard-ink);
		font-weight: 700;
		white-space: nowrap;
	}

	.st.live {
		color: var(--scoreboard-num);
	}

	.sw {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 500;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.n {
		text-align: right;
	}

	.pulse {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--scoreboard-num);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--scoreboard-num) 30%, transparent);
	}

	.bt {
		min-height: 34px;
	}

	.nm {
		font-weight: 600;
		font-size: var(--t-md);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.rec,
	.proj {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		color: var(--scoreboard-ink-2);
	}

	.rec {
		font-size: var(--t-sm);
	}

	.proj {
		font-size: var(--t-lg);
		font-weight: 600;
		text-align: right;
	}

	.pts {
		font-family: var(--font-num);
		font-size: var(--t-xl);
		font-weight: 800;
		text-align: right;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: var(--scoreboard-ink);
	}

	/* Once a game has started the side ahead reads at a glance: bright, the side behind muted. */
	.behind .pts,
	.behind .nm {
		color: color-mix(in srgb, var(--scoreboard-ink) 55%, transparent);
	}

	.me .pts {
		color: var(--scoreboard-num);
	}

	.me.behind .pts {
		color: color-mix(in srgb, var(--scoreboard-num) 60%, transparent);
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

		.bh,
		.bt {
			grid-template-columns: 26px minmax(0, 1fr) auto 40px 48px;
			column-gap: 6px;
		}

		.bh {
			grid-template-columns: auto minmax(0, 1fr) 40px 48px;
		}

		.pts {
			font-size: var(--t-lg);
		}

		.proj {
			font-size: var(--t-md);
		}
	}
</style>
