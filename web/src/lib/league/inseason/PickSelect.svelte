<script lang="ts" module>
	/** One choice, and a group of them (an optgroup when it has a label). */
	export interface PickOption {
		value: string;
		label: string;
	}
	export interface PickGroup {
		label: string | null;
		options: readonly PickOption[];
	}
</script>

<script lang="ts">
	/** A labelled choice on an in-season screen (the trades a player holds, the team a trade is
	 * with): its words, then the native select, which gives way first on a narrow line. The options
	 * come as data, not a snippet, so the select needs no runtime the shell's shared chunk carries. */
	interface Props {
		label: string;
		value: string;
		groups: readonly PickGroup[];
		onchange: (value: string) => void;
	}

	let { label, value, groups, onchange }: Props = $props();
</script>

<label class="pick">
	<span>{label}</span>
	<select {value} onchange={(event) => onchange(event.currentTarget.value)}>
		{#each groups as group, i (i)}
			{#if group.label === null}
				{#each group.options as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			{:else}
				<optgroup label={group.label}>
					{#each group.options as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</optgroup>
			{/if}
		{/each}
	</select>
</label>

<style>
	.pick {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-width: 0;
		white-space: nowrap;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	select {
		height: 36px;
		max-width: 100%;
		min-width: 0;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--ink);
		padding: 0 var(--s-2);
		font: inherit;
	}
</style>
