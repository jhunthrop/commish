<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import Quiet from './Quiet.svelte';

	/**
	 * Quiet actions folded behind one quiet button, for a bar that has no room to show them all:
	 * the phone's sheet tools. The actions inside are Quiet buttons and links. Choosing one, a tap
	 * outside or Escape closes it.
	 */
	interface Props {
		/** The button's words: "More". */
		label: string;
		/** The id the button points at. Unique on the page. */
		id: string;
		children: Snippet;
	}

	let { label, id, children }: Props = $props();

	let open = $state(false);
	let root: HTMLElement | undefined = $state();

	function close(): void {
		open = false;
	}

	function onWindowPointer(event: PointerEvent): void {
		if (open && root && event.target instanceof Node && !root.contains(event.target)) close();
	}

	function onKey(event: KeyboardEvent): void {
		if (!open || event.key !== 'Escape') return;
		event.preventDefault();
		close();
		root?.querySelector<HTMLElement>('button')?.focus();
	}

	/** An action chosen inside closes the menu once it has run. */
	function onChoose(event: MouseEvent): void {
		if (event.target instanceof Element && event.target.closest('a, button')) close();
	}
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onKey} />

<span class="menu" bind:this={root}>
	<Quiet size="sm" expanded={open} controls={id} onclick={() => (open = !open)}>
		{label}<Icon name="more" size={16} />
	</Quiet>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="items" {id} hidden={!open} onclick={onChoose}>
		{@render children()}
	</div>
</span>

<style>
	.menu {
		position: relative;
		display: inline-flex;
	}

	.items {
		position: absolute;
		top: calc(100% + var(--s-1));
		right: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--s-1);
		min-width: 180px;
		padding: var(--s-2);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--bg);
		box-shadow: var(--shadow-pop);
	}

	.items[hidden] {
		display: none;
	}

	.items :global(.action) {
		justify-content: flex-start;
		border-color: transparent;
	}
</style>
