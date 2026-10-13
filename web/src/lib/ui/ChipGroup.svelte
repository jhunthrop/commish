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
		children: Snippet;
	}

	let { label, variant = 'joined', fit = false, children }: Props = $props();

	// The variant fixes the group's shape for its lifetime, so reading it once at setup is the intent.
	markChipGroup(untrack(() => variant) === 'joined');
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
