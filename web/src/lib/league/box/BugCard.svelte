<script lang="ts">
	import type { Snippet } from 'svelte';
	import TeamAvatar from './TeamAvatar.svelte';
	import { BOX } from './box.ts';
	import type { Bug } from '../home/home.ts';

	/** One score bug on the lit board (Lane 66i), the League page's and the front door's: the state at
	 * its head (the next kickoff, in play, final), then each side with its avatar, record, projection
	 * and points so far. Once a game has started the side ahead is bright and the side behind muted;
	 * before kickoff both read alike. The drafter's game carries the orange rim. Large on the front
	 * door, where it leads the page; a foot line may follow the sides. */
	interface Props {
		bug: Bug;
		href: string;
		size?: 'md' | 'lg';
		/** The league's name above the head, where bugs of several leagues sit together. */
		label?: string | null;
		foot?: Snippet;
	}

	let { bug, href, size = 'md', label = null, foot }: Props = $props();
	const avatar = $derived(size === 'lg' ? 34 : 26);
</script>

<a class="bug {size}" class:mine={bug.mine} {href}>
	{#if label}<span class="lb">{label}</span>{/if}
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
			<TeamAvatar name={side.name} size={avatar} me={side.me} board src={side.avatar} />
			<span class="nm">{side.name}</span>
			<span class="rec">{side.record}</span>
			<span class="proj">{side.proj}</span>
			<span class="pts">{side.pts}</span>
		</span>
	{/each}
	{#if foot}<span class="ft">{@render foot()}</span>{/if}
</a>

<style>
	.bug {
		display: flex;
		flex-direction: column;
		gap: 2px;
		height: 100%;
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

	.lb {
		font-size: var(--t-xs);
		font-weight: 600;
		color: var(--scoreboard-ink-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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

	.ft {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		margin-top: 6px;
		padding-top: var(--s-2);
		border-top: 1px solid var(--scoreboard-line);
		font-size: var(--t-sm);
		color: var(--scoreboard-ink-2);
	}

	/* The front door's lead bug: the same rows, larger, the page's first figure. */
	.lg {
		padding: var(--s-3) var(--s-4);
		gap: 4px;
	}

	.lg .bh {
		grid-template-columns: auto minmax(0, 1fr) 72px 84px;
		min-height: 28px;
		font-size: var(--t-sm);
	}

	.lg .bt {
		grid-template-columns: 34px minmax(0, 1fr) auto 72px 84px;
		min-height: 50px;
	}

	.lg .nm {
		font-size: var(--t-lg);
	}

	.lg .proj {
		font-size: var(--t-xl);
	}

	.lg .pts {
		font-size: var(--t-2xl);
	}

	@media (max-width: 760px) {
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

		.lg .bh {
			grid-template-columns: auto minmax(0, 1fr) 54px 62px;
			font-size: var(--t-xs);
		}

		.lg .bt {
			grid-template-columns: 34px minmax(0, 1fr) auto 54px 62px;
			min-height: 42px;
		}

		.lg .nm {
			font-size: var(--t-md);
		}

		.lg .proj {
			font-size: var(--t-lg);
		}

		.lg .pts {
			font-size: var(--t-xl);
		}

		.ft {
			font-size: var(--t-xs);
		}
	}
</style>
