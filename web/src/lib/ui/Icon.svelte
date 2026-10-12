<script lang="ts">
	import { ICONS, type IconName } from './icons.ts';

	interface Props {
		name: IconName;
		size?: number;
	}

	let { name, size = 22 }: Props = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#each ICONS[name] as { tag, ...attrs }, i (i)}
		<svelte:element this={tag} xmlns="http://www.w3.org/2000/svg" {...attrs} />
	{/each}
</svg>
