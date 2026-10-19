<script lang="ts">
	/** An opponent's rank in points allowed, "24th", tinted by how easy the matchup is (green the
	 * easiest third, rose the hardest): the order's and the week's tables share it (Lane 66w). The rank
	 * prints with the tint, so the tint is never the only channel. */
	interface Props {
		/** "24th", or the empty mark without a rank. */
		text: string;
		ease: 'easy' | 'hard' | 'even' | null;
	}

	let { text, ease }: Props = $props();
</script>

{#if ease === null}<span class="none">{text}</span>{:else}<span class="rk {ease}">{text}</span>{/if}

<style>
	.rk {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		min-width: 40px;
		height: 22px;
		padding: 0 6px;
		border-radius: var(--r-sm);
	}

	.rk.easy {
		background: var(--gain-bg);
		color: var(--gain-ink);
	}

	.rk.hard {
		background: var(--loss-bg);
		color: var(--loss-ink);
	}

	.none {
		color: var(--ink-3);
	}
</style>
