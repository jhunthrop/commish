<script lang="ts">
	import Icon from './Icon.svelte';

	interface Props {
		/** The word the tag prints: "Target", or your own. */
		label: string;
		/** Given, the chip carries a small button that takes the tag off. */
		onremove?: () => void;
	}

	let { label, onremove }: Props = $props();
</script>

<!-- A tag is yours, so it takes your color: orange marks the brand, the verb and you. -->
<span class="tag">
	{label}
	{#if onremove}
		<button type="button" class="off" aria-label="Take off {label}" onclick={onremove}>
			<Icon name="close" size={12} />
		</button>
	{/if}
</span>

<style>
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		height: 20px;
		padding: 0 6px;
		border-radius: var(--r-sm);
		border: 1px solid color-mix(in srgb, var(--accent-text) 40%, transparent);
		color: var(--accent-text);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		white-space: nowrap;
	}

	.off {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		margin-right: -4px;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
</style>
