<script lang="ts">
	import Icon from './Icon.svelte';
	import Place from './Place.svelte';
	import { SHEET_MARK, addLabel, placeLabel } from './sheet-mark.ts';

	/** A board row's sheet control. Before he is on your sheet: a quiet plus that a Row shows on its
	 * hover and focus, opening to the words "Add to my sheet". After: a state, not a button, an ink
	 * check with his place on your sheet, linking to the sheet. */
	interface Props {
		/** Who the control is about, for its accessible name. */
		name: string;
		/** His place on your sheet, 1-based, or null while he is not on it. */
		place: number | null;
		/** Your sheet's page. */
		sheetHref: string;
		onadd: () => void;
		/** On a phone the plus says its word, "Add", with no hover to open it (the Rankings row, Lane
		 * 209: one verb per row, named). */
		named?: boolean;
	}

	let { name, place, sheetHref, onadd, named = false }: Props = $props();
</script>

{#if place === null}
	<button
		type="button"
		class="add"
		class:named
		data-reveal
		aria-label={addLabel(name)}
		onclick={onadd}
	>
		<span class="words">{SHEET_MARK.add}</span>
		{#if named}<span class="short" aria-hidden="true">{SHEET_MARK.addShort}</span>{/if}
		<span class="disc"><Icon name="plus" size={16} /></span>
	</button>
{:else}
	<a class="on" class:named href={sheetHref} aria-label={placeLabel(name, place)}>
		<span class="disc"><Icon name="check" size={16} /></span>
		<Place {place} ordinal />
	</a>
{/if}

<style>
	.add,
	.on {
		display: inline-flex;
		align-items: center;
		gap: var(--s-2);
		height: 32px;
		text-decoration: none;
		font-size: var(--t-sm);
		font-weight: 500;
		white-space: nowrap;
	}

	.disc {
		flex: none;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
	}

	/* The plus is an outline, quiet as every action that is not the one verb. Its words stay folded
	   until the row is hovered or focused, then open leftward over the row's own surface. */
	.add {
		padding: 0 2px 0 var(--s-3);
		border: 1px solid transparent;
		border-radius: var(--r-pill);
		background: transparent;
		color: var(--ink-2);
		cursor: pointer;
	}

	.add .disc {
		border: 1px solid var(--line-strong);
	}

	.words,
	.short {
		display: none;
	}

	.add:hover,
	.add:focus-visible {
		color: var(--ink);
		background: var(--surface);
		border-color: var(--line-strong);
	}

	.add:hover .words,
	.add:focus-visible .words {
		display: inline;
	}

	.add:hover .disc,
	.add:focus-visible .disc {
		border-color: var(--ink-3);
	}

	/* On your sheet: filled in ink like a pressed chip, never orange, with his place beside it. */
	.on {
		color: var(--ink-2);
	}

	.on .disc {
		background: var(--ink);
		color: var(--bg);
	}

	.on:hover .disc {
		outline: 2px solid var(--line-strong);
		outline-offset: 1px;
	}

	/* A phone's Rankings row names its verb: "Add" in a quiet outline beside the plus, the row's one
	   verb, at the height of its game line. */
	@media (max-width: 760px) {
		.named {
			height: 24px;
			gap: 4px;
			font-size: var(--t-xs);
			font-weight: 600;
		}

		.add.named {
			padding-left: var(--s-2);
			border-color: var(--line-strong);
		}

		.add.named .short {
			display: inline;
		}

		.add.named .disc {
			width: 18px;
			height: 18px;
			border: 0;
		}

		.add.named:hover .words,
		.add.named:focus-visible .words {
			display: none;
		}

		.on.named .disc {
			width: 20px;
			height: 20px;
		}
	}
</style>
