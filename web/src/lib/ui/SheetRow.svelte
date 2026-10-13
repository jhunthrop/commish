<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Position } from '#lib/types/player.ts';
	import Face from './Face.svelte';
	import Icon from './Icon.svelte';
	import Label from './Label.svelte';
	import NoteLine from './NoteLine.svelte';
	import PositionPill from './PositionPill.svelte';
	import TagChip from './TagChip.svelte';
	import TierChip from './TierChip.svelte';

	interface Props {
		id: string;
		name: string;
		position: Position;
		/** His rank at his position on your sheet. */
		positionRank: number;
		team: string | null;
		headshot: string | null;
		/** Your rank, the row's one number. */
		rank: number;
		/** His tier, printed as a chip where no strips are drawn (the All view). */
		tier?: number | null;
		/** The words the tags print. */
		tags: readonly string[];
		note: string | null;
		/** Our rank on this format's board, printed small beside yours, or null when we do not rank him. */
		ourRank?: number | null;
		/** The row is open: the whole note, and the editor below. */
		open?: boolean;
		/** Lifted by the keyboard: arrows move him until he is dropped. */
		lifted?: boolean;
		/** The handle is shown. Hidden while a search narrows the sheet. */
		movable?: boolean;
		ontoggle?: () => void;
		/** Keys on the handle: Space or Enter lift and drop, arrows move, Escape puts him back. */
		ongripkeydown?: (event: KeyboardEvent) => void;
		/** Faces in the first screen load eagerly. */
		eager?: boolean;
		editor?: Snippet;
	}

	let {
		id,
		name,
		position,
		positionRank,
		team,
		headshot,
		rank,
		tier = null,
		tags,
		note,
		ourRank,
		open = false,
		lifted = false,
		movable = true,
		ontoggle,
		ongripkeydown,
		eager = false,
		editor
	}: Props = $props();
</script>

<!-- data-row-id and data-grip are how the drag controller (lib/sheet/drag.ts) finds the rows and
	 their handles without a reactive update per frame. -->
<div class="row" class:open class:lifted class:noted={note !== null} data-row-id={id}>
	{#if movable}
		<button
			type="button"
			class="grip"
			data-grip={id}
			aria-label="Move {name}, rank {rank}"
			aria-pressed={lifted}
			aria-keyshortcuts="Space ArrowUp ArrowDown Escape"
			onkeydown={ongripkeydown}
		>
			<Icon name="grip" size={18} />
		</button>
	{:else}
		<span></span>
	{/if}
	<span class="rk">{rank}</span>
	<Face src={headshot} size={40} loading={eager ? 'eager' : 'lazy'} />
	<span class="who">
		<button type="button" class="name" aria-expanded={open} onclick={ontoggle}>{name}</button>
		<span class="meta">
			<PositionPill {position} rank={positionRank} />
			{#if tier !== null}<TierChip {tier} />{/if}
			{#if team}<span>{team}</span>{/if}
			{#each tags as tag (tag)}<span class="narrow"><TagChip label={tag} /></span>{/each}
		</span>
		{#if note}<NoteLine {note} {open} />{/if}
	</span>
	<span class="tags">
		{#each tags as tag (tag)}<TagChip label={tag} />{/each}
	</span>
	<span class="ours">
		{#if ourRank !== undefined}
			<Label>{ourRank === null ? 'We do not rank him' : `Our rank ${String(ourRank)}`}</Label>
		{/if}
	</span>
	{#if open && editor}
		<div class="editor">{@render editor()}</div>
	{/if}
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: 32px 34px 40px minmax(0, 1fr) auto 112px;
		align-items: center;
		column-gap: var(--s-3);
		min-height: var(--row-h);
		padding: 4px var(--s-3) 4px var(--s-1);
		border-bottom: 1px solid var(--line);
		background: var(--bg);
		position: relative;
		/* A sheet is hundreds of rows. Rows off screen skip layout and paint, which keeps a drag's
		   auto-scroll inside the frame on a phone. */
		content-visibility: auto;
		/* The content box of a row never drawn yet: 52px less its padding and line. The drag
		   reads every row's height at the start, so the estimate has to match the drawn row. */
		contain-intrinsic-size: auto 43px;
	}

	.noted {
		contain-intrinsic-size: auto 61px;
	}

	.row:hover {
		background: var(--surface);
	}

	.open {
		background: var(--surface);
	}

	.lifted {
		background: var(--accent-wash);
		box-shadow: var(--shadow-pop);
		z-index: 2;
	}

	/* Set by the drag controller on the row under the finger. */
	.row:global([data-dragging]) {
		background: var(--accent-wash);
		box-shadow: var(--shadow-pop);
		z-index: 3;
		cursor: grabbing;
	}

	.grip {
		display: grid;
		place-items: center;
		width: 32px;
		height: 40px;
		padding: 0;
		border: 0;
		border-radius: var(--r-sm);
		background: transparent;
		color: var(--ink-3);
		cursor: grab;
		touch-action: none;
	}

	.grip:hover,
	.grip[aria-pressed='true'] {
		color: var(--ink);
		background: var(--surface-2);
	}

	.rk {
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-xl);
		line-height: 1;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.who {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		align-items: flex-start;
	}

	.name {
		max-width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		font-weight: 600;
		font-size: var(--t-md);
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
	}

	.name:hover {
		text-decoration: underline;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
		overflow: hidden;
		font-size: var(--t-sm);
		color: var(--ink-3);
		white-space: nowrap;
		max-width: 100%;
	}

	.narrow {
		display: none;
	}

	.tags {
		display: flex;
		gap: 4px;
		justify-content: flex-end;
	}

	.ours {
		text-align: right;
	}

	.editor {
		grid-column: 3 / -1;
		padding: var(--s-2) 0 var(--s-3);
	}

	@media (max-width: 760px) {
		.row {
			grid-template-columns: 28px 26px 40px minmax(0, 1fr);
			column-gap: var(--s-2);
			padding: 4px 0;
		}

		.rk {
			font-size: var(--t-lg);
		}

		.tags,
		.ours {
			display: none;
		}

		.narrow {
			display: inline-flex;
		}

		.editor {
			grid-column: 1 / -1;
			padding: var(--s-2) var(--s-2) var(--s-3);
		}
	}
</style>
