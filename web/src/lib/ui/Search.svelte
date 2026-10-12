<script lang="ts">
	import Icon from './Icon.svelte';

	interface Props {
		/** What the field searches, as a person reads it: "Search 400 players". */
		placeholder: string;
		label: string;
		value?: string;
		/** Called on the first focus, so a page can load its index only when someone searches. */
		onfirstfocus?: () => void;
		oninput?: (value: string) => void;
	}

	let { placeholder, label, value = $bindable(''), onfirstfocus, oninput }: Props = $props();

	const FOCUS_KEY = '/';
	let input: HTMLInputElement | undefined = $state();
	let focusedOnce = false;

	function isTyping(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLElement &&
			(target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
		);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key !== FOCUS_KEY || event.metaKey || event.ctrlKey || event.altKey) return;
		if (isTyping(event.target)) return;
		event.preventDefault();
		input?.focus();
	}

	function onFocus(): void {
		if (focusedOnce) return;
		focusedOnce = true;
		onfirstfocus?.();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<label class="search">
	<Icon name="search" size={18} />
	<input
		bind:this={input}
		bind:value
		type="search"
		{placeholder}
		aria-label={label}
		aria-keyshortcuts={FOCUS_KEY}
		onfocus={onFocus}
		oninput={() => oninput?.(value)}
	/>
	<kbd>{FOCUS_KEY}</kbd>
</label>

<style>
	.search {
		width: 100%;
		display: flex;
		align-items: center;
		gap: var(--s-2);
		height: 42px;
		padding: 0 var(--s-3);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--ink-3);
	}

	.search:focus-within {
		border-color: var(--focus);
	}

	input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		color: var(--ink);
		outline: none;
	}

	input::placeholder {
		color: var(--ink-3);
	}

	kbd {
		font-family: var(--font-ui);
		font-size: var(--t-xs);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-sm);
		padding: 1px 6px;
	}

	@media (max-width: 760px) {
		.search {
			height: 38px;
		}

		kbd {
			display: none;
		}
	}
</style>
