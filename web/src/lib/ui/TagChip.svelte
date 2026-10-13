<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from './icons.ts';
	import type { TagTone } from './tag.ts';

	interface Props {
		/** The word the tag prints: "Target", or your own. */
		label: string;
		/** you, your color, for every tag but one that steers you away (Avoid), drawn as a loss. */
		tone?: TagTone;
		/** A mark before the words: the tag mark on a phone row's count of tags. */
		icon?: IconName;
		/** Given, the chip carries a small button that takes the tag off. */
		onremove?: () => void;
	}

	let { label, tone = 'you', icon, onremove }: Props = $props();
</script>

<!-- A tag is yours, so it takes your color: orange marks the brand, the verb and you. Avoid is
	 the one tag that warns, so it takes the loss tone. -->
<span class="tag {tone}">
	{#if icon}<Icon name={icon} size={12} />{/if}
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
		border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		white-space: nowrap;
	}

	.you {
		color: var(--accent-text);
	}

	.loss {
		color: var(--loss-ink);
		background: var(--loss-bg);
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
