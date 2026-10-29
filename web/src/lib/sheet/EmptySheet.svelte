<script lang="ts">
	import { boardPoolCount } from '#lib/format/pool-words.ts';
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Place from '#lib/ui/Place.svelte';
	import PlayerLine from '#lib/ui/PlayerLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import type { DirectoryPlayer } from './directory.ts';
	import type { OurBoardState } from './our-board.svelte.ts';
	import { FORMAT_LABELS } from './format.ts';
	import type { BoardFormat } from './model.ts';
	import { SHEET } from './words.ts';

	/**
	 * A sheet with no one on it: the first players "Start from our board" would put on it, with
	 * their faces, so the verb shows what it does before it is pressed.
	 */
	interface Props {
		/** Our board for the format, once it is here. */
		board: readonly DirectoryPlayer[] | null;
		/** Whether it is on its way, here, missing for this format, or failed to load. */
		boardState: OurBoardState;
		format: BoardFormat;
		starting: boolean;
		problem: string | null;
		onstart: () => void;
		onimport: () => void;
	}

	let { board, boardState, format, starting, problem, onstart, onimport }: Props = $props();

	/** How many of our board's first players the preview shows. */
	const PREVIEWED = 5;

	const first = $derived(board?.slice(0, PREVIEWED) ?? []);
	/** The board the sheet starts from, every row of it: the run's ranked players, then its kickers and
	 * defenses in draft order, a build-time count of the run's board file. Its pool named, kickers and
	 * defenses said, so it never reads against the front door's ranked count (the sweep's M4). */
	const sheetCount = $derived(
		board !== null && board.length > PREVIEWED ? boardPoolCount(board) : null
	);
</script>

<Panel as="section" label={SHEET.startHead}>
	<div class="start">
		<div class="preview">
			{#if boardState === 'none'}
				<p class="gone">Our {FORMAT_LABELS[format]} board is not out yet</p>
			{:else if boardState === 'failed'}
				<p class="gone">{SHEET.boardFailed}</p>
			{:else}
				<Label>Our {FORMAT_LABELS[format]} board, best first</Label>
			{/if}
			<ol aria-busy={boardState === 'loading'} class:held={boardState === 'loading'}>
				{#each first as player, index (player.id)}
					<li>
						<PlayerLine
							name={player.name}
							position={player.position}
							positionRank={player.held ?? player.positionRank}
							team={player.team}
							headshot={player.headshot ?? undefined}
							size={40}
						>
							{#snippet trailing()}<Place place={index + 1} />{/snippet}
						</PlayerLine>
					</li>
				{/each}
			</ol>
			{#if sheetCount !== null}<Label>All {sheetCount}</Label>{/if}
		</div>
		<div class="verbs">
			<!-- With no board for this format, importing is the one thing left to do. -->
			{#if boardState === 'none'}
				<Verb size="lg" onclick={onimport}>{SHEET.importSheet}</Verb>
			{:else}
				<Verb size="lg" disabled={starting} onclick={onstart}>{SHEET.start}</Verb>
				<Quiet size="lg" onclick={onimport}>{SHEET.importSheet}</Quiet>
			{/if}
			{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
		</div>
	</div>
</Panel>

<style>
	.start {
		display: grid;
		grid-template-columns: minmax(0, 560px) minmax(0, 280px);
		justify-content: start;
		align-items: center;
		gap: var(--s-6);
	}

	.preview {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		min-width: 0;
	}

	ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	/* Holds five lines open while our board loads, so nothing below moves when they land. */
	.held {
		min-height: calc(5 * 52px);
	}

	.gone {
		margin: 0;
		font-size: var(--t-md);
		color: var(--ink-2);
	}

	li {
		border-bottom: 1px solid var(--line);
	}

	.verbs {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--s-3);
	}

	.problem {
		margin: 0;
		color: var(--loss-ink);
		font-size: var(--t-sm);
	}

	@media (max-width: 760px) {
		.start {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--s-4);
		}
	}
</style>
