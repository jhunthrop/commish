<script lang="ts">
	import Label from './Label.svelte';
	import Quiet from './Quiet.svelte';

	/** A file chosen through the site's own quiet button, with the chosen file's name beside it,
	 * never the browser's grey control. */
	interface Props {
		/** The button's words: "Choose a CSV". */
		label: string;
		/** File types the picker offers, as the input's accept. */
		accept?: string;
		/** Words beside the button until a file is chosen. */
		empty?: string;
		onpick: (file: File) => void;
	}

	let { label, accept, empty = 'No file yet', onpick }: Props = $props();

	let input: HTMLInputElement | undefined = $state();
	let chosen = $state<string | null>(null);

	function onChange(): void {
		const file = input?.files?.[0];
		if (!file) return;
		chosen = file.name;
		onpick(file);
	}
</script>

<span class="pick">
	<Quiet onclick={() => input?.click()}>{label}</Quiet>
	<span class="name" class:chosen={chosen !== null}>
		{#if chosen}{chosen}{:else}<Label>{empty}</Label>{/if}
	</span>
	<input
		bind:this={input}
		type="file"
		{accept}
		tabindex="-1"
		aria-hidden="true"
		onchange={onChange}
	/>
</span>

<style>
	.pick {
		display: inline-flex;
		align-items: center;
		gap: var(--s-3);
		min-width: 0;
	}

	.name {
		min-width: 0;
		font-size: var(--t-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chosen {
		font-weight: 600;
		color: var(--ink);
	}

	input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
</style>
