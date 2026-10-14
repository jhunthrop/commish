<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import Quiet from './Quiet.svelte';

	/**
	 * Quiet actions folded behind one quiet button, for a bar that has no room to show them all:
	 * the phone's sheet tools. The actions inside are Quiet buttons and links. Choosing one, a tap
	 * outside or Escape closes it. As a title it is a heading's own words that open the other places
	 * of its kind: the league page's name, with the account's other leagues inside.
	 */
	interface Props {
		/** The button's words: "More", or the title's. */
		label: string;
		/** The id the button points at. Unique on the page. */
		id: string;
		/** quiet: a quiet button with the more mark, its list under its right edge. title: the words in
		 * the face around it (a DisplayTitle) with a chevron, its list under its left edge. */
		face?: 'quiet' | 'title';
		children: Snippet;
	}

	let { label, id, face = 'quiet', children }: Props = $props();

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
	{#if face === 'title'}
		<button
			type="button"
			class="as-title"
			aria-expanded={open}
			aria-controls={id}
			onclick={() => (open = !open)}
		>
			<span class="words">{label}</span><Icon name="chevron" size={20} />
		</button>
	{:else}
		<Quiet size="sm" expanded={open} controls={id} onclick={() => (open = !open)}>
			{label}<Icon name="more" size={16} />
		</Quiet>
	{/if}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="items" class:start={face === 'title'} {id} hidden={!open} onclick={onChoose}>
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

	.items.start {
		right: auto;
		left: 0;
		min-width: min(320px, 90vw);
		text-transform: none;
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: var(--t-md);
		line-height: 1.3;
	}

	.as-title {
		display: inline-flex;
		align-items: center;
		gap: var(--s-2);
		max-width: 100%;
		margin: 0;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		text-transform: inherit;
		letter-spacing: inherit;
		text-align: left;
		cursor: pointer;
	}

	.as-title .words {
		min-width: 0;
	}

	.as-title:hover {
		color: var(--ink-2);
	}

	.items[hidden] {
		display: none;
	}

	.items :global(.action) {
		justify-content: flex-start;
		border-color: transparent;
	}
</style>
