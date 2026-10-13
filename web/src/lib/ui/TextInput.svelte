<script lang="ts">
	interface Props {
		value?: string;
		/** Names the field for assistive tech when no visible label sits beside it. */
		label: string;
		/** What goes here, as an example: "Tuesday night, 12 PPR". */
		placeholder?: string;
		maxlength?: number;
		/** A datalist's id, to offer names while typing. */
		list?: string;
		id?: string;
		/** Enter in the field does this. */
		onenter?: () => void;
	}

	let { value = $bindable(''), label, placeholder, maxlength, list, id, onenter }: Props = $props();
</script>

<input
	{id}
	bind:value
	aria-label={label}
	{placeholder}
	{maxlength}
	{list}
	onkeydown={(e) => {
		if (e.key === 'Enter' && onenter) {
			e.preventDefault();
			onenter();
		}
	}}
/>

<style>
	input {
		flex: 1;
		min-width: 180px;
		height: 38px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--ink);
		padding: 0 var(--s-3);
		font-size: var(--t-sm);
	}

	input:focus {
		border-color: var(--focus);
		outline: none;
	}

	input::placeholder {
		color: var(--ink-3);
	}
</style>
