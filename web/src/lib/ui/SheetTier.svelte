<script lang="ts">
	import Icon from './Icon.svelte';
	import TierStrip from './TierStrip.svelte';

	interface Props {
		tier: number;
		count: number;
		/** The plural the count reads with: "WRs". */
		group: string;
		/** The id of the row the tier starts at. The drag controller moves the strip by it. */
		startId: string;
		/** The first tier stays at the top. Every other one moves and can join the one above. */
		movable: boolean;
		lifted?: boolean;
		ongripkeydown?: (event: KeyboardEvent) => void;
		onjoin?: () => void;
	}

	let {
		tier,
		count,
		group,
		startId,
		movable,
		lifted = false,
		ongripkeydown,
		onjoin
	}: Props = $props();
</script>

<!-- Your tier strip on the sheet: the board's strip with a handle to drag where the tier starts. -->
<div class="tier" class:lifted data-strip-start={startId}>
	<TierStrip {tier} {count} {group} cliff={null} unit="">
		{#snippet tail()}
			{#if movable}
				<span class="tools">
					<button
						type="button"
						class="tool"
						data-strip-grip={startId}
						aria-label="Move where tier {tier} starts"
						aria-pressed={lifted}
						aria-keyshortcuts="Space ArrowUp ArrowDown Escape"
						onkeydown={ongripkeydown}
					>
						<Icon name="grip" size={18} />
					</button>
					<button
						type="button"
						class="tool"
						aria-label="Join tier {tier} to tier {tier - 1}"
						onclick={onjoin}
					>
						<Icon name="close" size={16} />
					</button>
				</span>
			{/if}
		{/snippet}
	</TierStrip>
</div>

<style>
	.tier {
		position: relative;
		background: var(--bg);
		padding-top: var(--s-3);
	}

	.lifted,
	.tier:global([data-dragging]) {
		z-index: 3;
		box-shadow: var(--shadow-pop);
	}

	.tools {
		display: flex;
		gap: var(--s-1);
	}

	.tool {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		padding: 0;
		border: 0;
		border-radius: var(--r-sm);
		background: transparent;
		color: var(--ink-2);
		cursor: pointer;
		touch-action: none;
	}

	.tool:hover,
	.tool[aria-pressed='true'] {
		color: var(--ink);
		background: color-mix(in srgb, var(--ink) 8%, transparent);
	}

	[data-strip-grip] {
		cursor: grab;
	}
</style>
