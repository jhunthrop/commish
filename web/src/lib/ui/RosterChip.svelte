<script lang="ts">
	/** Whose roster holds a player in the member's league: Yours on the accent, Free in green, another
	 * team's name in quiet ink. The order's and the week's tables share it (Lane 66w); folded onto his
	 * club line it is smaller on a phone (fold), a long team name cut. */
	interface Props {
		kind: 'yours' | 'free' | 'team';
		words: string;
		/** fold: on his club line, smaller on a phone. */
		size?: 'md' | 'fold';
	}

	let { kind, words, size = 'md' }: Props = $props();
</script>

<span class="own {kind} {size}">{words}</span>

<style>
	.own {
		display: inline-flex;
		align-items: center;
		max-width: 100%;
		height: 22px;
		padding: 0 var(--s-2);
		border-radius: var(--r-pill);
		font-size: var(--t-xs);
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.yours {
		background: var(--accent);
		color: var(--accent-ink);
	}

	.free {
		background: var(--gain-bg);
		color: var(--gain-ink);
	}

	.team {
		display: inline;
		padding: 0;
		font-size: var(--t-sm);
		font-weight: 500;
		color: var(--ink-3);
	}

	@media (max-width: 760px) {
		.fold {
			height: 18px;
			padding: 0 6px;
			font-size: 10px;
		}

		.fold.team {
			display: block;
			padding: 0;
			font-size: var(--t-xs);
		}
	}
</style>
