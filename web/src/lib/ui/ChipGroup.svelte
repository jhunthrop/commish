<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { markChipGroup } from './chips.ts';

	interface Props {
		/** What the chips choose between, for assistive tech: "Scoring", "Position". */
		label: string;
		/** joined draws the chips on one pill track, loose lays them out as a wrapping row. */
		variant?: 'joined' | 'loose';
		/** As wide as its chips, never wider than a form (--form-w): a choice above a form's fields. */
		fit?: boolean;
		/** one: a single choice, the pressed chip is it. many: any number pressed at once, each marked
		 * with a check, like the leagues to follow. */
		choose?: 'one' | 'many';
		children: Snippet;
	}

	let { label, variant = 'joined', fit = false, choose = 'one', children }: Props = $props();

	// The variant and the choice fix the group's shape for its lifetime, so reading them once at
	// setup is the intent.
	markChipGroup(untrack(() => ({ joined: variant === 'joined', many: choose === 'many' })));
</script>

<div class="group {variant}" class:fit role="group" aria-label={label}>
	{@render children()}
</div>

<style>
	.group {
		display: flex;
		align-items: center;
	}

	.joined {
		gap: 4px;
		padding: 3px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
	}

	.loose {
		flex-wrap: wrap;
		gap: var(--s-2);
	}

	.fit {
		align-self: flex-start;
		width: fit-content;
		max-width: min(100%, var(--form-w));
	}
</style>
