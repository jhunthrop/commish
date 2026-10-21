<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	/** A shelf over the screen (Lane 113): a modal dialog, a bottom sheet about nine tenths of the
	 * phone's height with a drag handle, a side shelf 480 px wide from the right at a desk, the screen
	 * dimmed behind it. The browser's modal dialog traps the focus and takes Escape; a tap on the dim,
	 * the close button or a drag down on the handle or the top row closes it too. Each asks the owner to close
	 * (onclose), which unmounts it: the owner keeps the address and gives the focus back. Its body
	 * scrolls inside; the foot, the screen's one verb, stays at the bottom. */
	interface Props {
		/** What the shelf holds, for its name: the player's. */
		label: string;
		/** The close button's name. */
		closeLabel: string;
		onclose: () => void;
		/** Drawn at the top beside the close button: a link to the full page. */
		top?: Snippet;
		children: Snippet;
		/** Pinned at the bottom: the one verb. */
		foot?: Snippet;
	}

	let { label, closeLabel, onclose, top, children, foot }: Props = $props();

	/** A drag down this far on the handle closes the sheet; less springs it back. */
	const DISMISS_PX = 96;

	let dialog: HTMLDialogElement | undefined = $state();
	let closer: HTMLButtonElement | undefined = $state();
	/** Set as it unmounts, so its own close is not taken for one the owner did not ask for. */
	let leaving = false;
	/** The drag down from the handle as it moves, null at rest. */
	let drag = $state<{ from: number; by: number } | null>(null);

	onMount(() => {
		dialog?.showModal();
		// The focus starts on the close button, never on a link that would leave the screen.
		closer?.focus();
		return () => {
			leaving = true;
			dialog?.close();
		};
	});

	/** A close the owner did not ask for (the browser's own): the owner closes it too, so the address
	 * and the focus follow. */
	function onDialogClose(): void {
		if (!leaving) onclose();
	}

	/** Escape: the owner closes it, so the address and the focus follow. */
	function oncancel(event: Event): void {
		event.preventDefault();
		onclose();
	}

	/** A tap on the dim behind it lands on the dialog itself, outside its sheet. */
	function onclick(event: MouseEvent): void {
		if (event.target === dialog) onclose();
	}

	/** A drag from anywhere along the top but its link and button. */
	function ondown(event: PointerEvent): void {
		if (event.button !== 0) return;
		if (event.target instanceof Element && event.target.closest('a, button')) return;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		drag = { from: event.clientY, by: 0 };
	}

	function onmove(event: PointerEvent): void {
		if (drag !== null) drag = { ...drag, by: Math.max(0, event.clientY - drag.from) };
	}

	function onup(): void {
		const by = drag?.by ?? 0;
		drag = null;
		if (by > DISMISS_PX) onclose();
	}
</script>

<dialog
	class="shelf"
	class:dragging={drag !== null}
	aria-label={label}
	bind:this={dialog}
	{oncancel}
	{onclick}
	onclose={onDialogClose}
	style:--drag="{drag?.by ?? 0}px"
>
	<!-- The drag is the pointer's alone: Escape, the dim and the close button close it for every
	     other way in. -->
	<div
		class="head"
		role="presentation"
		onpointerdown={ondown}
		onpointermove={onmove}
		onpointerup={onup}
		onpointercancel={onup}
	>
		<div class="grab" aria-hidden="true"><span class="handle"></span></div>
		<div class="top">
			{@render top?.()}
			<button
				type="button"
				class="close"
				aria-label={closeLabel}
				onclick={onclose}
				bind:this={closer}><Icon name="close" size={20} /></button
			>
		</div>
	</div>
	<div class="body">{@render children()}</div>
	{#if foot}<div class="foot">{@render foot()}</div>{/if}
</dialog>

<style>
	/* A spring's settle, overshooting a touch before it rests (Sideline: things move like springs). */
	.shelf {
		--spring: linear(
			0,
			0.12 4%,
			0.42 11%,
			0.78 20%,
			0.97 28%,
			1.04 35%,
			1.03 45%,
			1 60%,
			0.995 75%,
			1
		);
		--spring-ms: 460ms;

		position: fixed;
		inset: 0 0 0 auto;
		box-sizing: border-box;
		display: none;
		flex-direction: column;
		width: min(480px, 100vw);
		max-width: 100vw;
		height: 100dvh;
		max-height: 100dvh;
		margin: 0;
		padding: 0;
		border: 0;
		border-left: 1px solid var(--line-strong);
		background: var(--bg);
		color: var(--ink);
		box-shadow: var(--shadow-pop);
		overscroll-behavior: contain;
		animation: in-side var(--spring-ms) var(--spring);
	}

	.shelf[open] {
		display: flex;
	}

	.shelf::backdrop {
		background: rgb(0 0 0 / 0.32);
	}

	/* The screen under the shelf stays where it is. */
	:global(html:has(dialog.shelf[open])) {
		overflow: hidden;
	}

	.grab {
		display: none;
	}

	.top {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--s-1);
		flex: none;
		padding: var(--s-2) var(--s-2) 0 var(--s-4);
	}

	.close {
		display: grid;
		place-items: center;
		width: var(--touch);
		height: var(--touch);
		padding: 0;
		border: 0;
		border-radius: var(--r-md);
		background: none;
		color: var(--ink-2);
		cursor: pointer;
	}

	.close:hover {
		color: var(--ink);
		background: var(--surface-2);
	}

	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0 var(--s-4) var(--s-4);
	}

	.foot {
		flex: none;
		padding: var(--s-3) var(--s-4) calc(var(--s-3) + env(safe-area-inset-bottom));
		border-top: 1px solid var(--line);
		background: var(--shell);
	}

	@keyframes in-side {
		from {
			transform: translateX(100%);
		}
	}

	@keyframes in-up {
		from {
			transform: translateY(100%);
		}
	}

	@media (max-width: 760px) {
		.shelf {
			inset: auto 0 0;
			width: 100%;
			max-width: 100%;
			height: 90dvh;
			max-height: 90dvh;
			border-left: 0;
			border-top: 1px solid var(--line-strong);
			border-radius: 16px 16px 0 0;
			transform: translateY(var(--drag));
			transition: transform var(--spring-ms) var(--spring);
			animation-name: in-up;
		}

		.shelf.dragging {
			transition: none;
		}

		.shelf::backdrop {
			background: rgb(0 0 0 / 0.55);
		}

		/* The handle and the whole top row: a drag down on them closes the sheet. */
		.head {
			flex: none;
			touch-action: none;
			cursor: grab;
		}

		.grab {
			display: flex;
			justify-content: center;
			flex: none;
			padding: var(--s-2) 0 var(--s-1);
		}

		.handle {
			width: 40px;
			height: 5px;
			border-radius: var(--r-pill);
			background: var(--line-strong);
		}

		.top {
			padding-top: 0;
		}
	}
</style>
