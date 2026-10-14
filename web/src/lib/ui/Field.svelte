<script lang="ts">
	interface Props {
		/** What the field holds, for assistive tech and as its visible label. */
		label: string;
		value?: string;
		/** A note or a pasted list takes lines. */
		multiline?: boolean;
		/** Rows a multiline field opens with. */
		rows?: number;
		maxlength?: number;
		placeholder?: string;
		/** The label stays for assistive tech only, where the field's place says what it is. */
		hideLabel?: boolean;
		/** Monospaced, for a pasted file. */
		mono?: boolean;
		onchange?: (value: string) => void;
		oninput?: (value: string) => void;
		onkeydown?: (event: KeyboardEvent) => void;
		/** A datalist's id, to offer names while typing. */
		list?: string;
		/** Enter in a one-line field does this. */
		onenter?: () => void;
		/** Takes focus when it appears, for a field opened by a tap. */
		autofocus?: boolean;
		/** What the field takes: a password is masked and never offered back. */
		kind?: 'text' | 'email' | 'password';
		/** The browser's autofill hint, "username" or "current-password". */
		autocomplete?: AutoFill;
	}

	let {
		label,
		value = $bindable(''),
		multiline = false,
		rows = 3,
		maxlength,
		placeholder,
		hideLabel = false,
		mono = false,
		onchange,
		oninput,
		onkeydown,
		autofocus = false,
		list,
		onenter,
		kind = 'text',
		autocomplete
	}: Props = $props();

	function focusOnMount(node: HTMLElement): void {
		if (autofocus) node.focus({ preventScroll: true });
	}
</script>

<label class="field" class:mono>
	<span class="name" class:hidden={hideLabel}>{label}</span>
	{#if multiline}
		<textarea
			bind:value
			{rows}
			{maxlength}
			{placeholder}
			use:focusOnMount
			onchange={() => onchange?.(value)}
			oninput={() => oninput?.(value)}
			{onkeydown}></textarea>
	{:else}
		<input
			bind:value
			type={kind}
			{autocomplete}
			{maxlength}
			{placeholder}
			{list}
			use:focusOnMount
			onchange={() => onchange?.(value)}
			oninput={() => oninput?.(value)}
			onkeydown={(event) => {
				onkeydown?.(event);
				if (event.key === 'Enter' && onenter) {
					event.preventDefault();
					onenter();
				}
			}}
		/>
	{/if}
</label>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.name {
		font-size: var(--t-xs);
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		font-weight: 500;
		color: var(--ink-3);
	}

	.hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	input,
	textarea {
		width: 100%;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--bg);
		color: var(--ink);
		font: inherit;
		font-size: var(--t-md);
		padding: var(--s-2) var(--s-3);
	}

	input {
		height: 38px;
	}

	textarea {
		resize: vertical;
		line-height: 1.4;
	}

	input:focus,
	textarea:focus {
		border-color: var(--focus);
	}

	.mono textarea {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: var(--t-sm);
	}
</style>
