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
		/** Set when the field drives a list of results: the list's id, whether it is open, the option
		 * the arrow keys are on, and the keys that move through it. */
		controls?: string;
		expanded?: boolean;
		activeOption?: string;
		onkeydown?: (event: KeyboardEvent) => void;
		/** The / key focuses this field. One field per page holds it: the top bar's. */
		shortcut?: boolean;
	}

	let {
		placeholder,
		label,
		value = $bindable(''),
		onfirstfocus,
		oninput,
		controls,
		expanded = false,
		activeOption,
		onkeydown,
		shortcut = true
	}: Props = $props();

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
		if (!shortcut) return;
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
		aria-keyshortcuts={shortcut ? FOCUS_KEY : undefined}
		role={controls ? 'combobox' : undefined}
		aria-controls={controls}
		aria-expanded={controls ? expanded : undefined}
		aria-autocomplete={controls ? 'list' : undefined}
		aria-activedescendant={activeOption}
		autocomplete="off"
		onfocus={onFocus}
		oninput={() => oninput?.(value)}
		{onkeydown}
	/>
	{#if shortcut}<kbd>{FOCUS_KEY}</kbd>{/if}
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
