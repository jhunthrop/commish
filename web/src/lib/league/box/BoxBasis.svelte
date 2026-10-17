<script lang="ts">
	import type { PlayerLine, ProjectionScoring } from '../inseason/api.ts';
	import { PTS_BASIS, factsReadLine, projBasis } from './box.ts';

	/** What a box score's numbers are, said once under the boxes, one short line each: the projection
	 * with its scoring and read (defenses' scoring named only when a defense is on the screen), points
	 * so far, and the Game cell's two figures with their read. */
	interface Props {
		/** The projection's read and scoring; null when the screen has no projection to speak of. */
		projection: { readAt: string | null; scoring: ProjectionScoring } | null;
		/** Every line the boxes drew. */
		lines: readonly PlayerLine[];
	}

	let { projection, lines }: Props = $props();

	const defense = $derived(lines.some((l) => l.player.position === 'DEF'));
	const facts = $derived(factsReadLine(lines));
</script>

<div class="basis">
	{#if projection}<p>{projBasis(projection.readAt, projection.scoring, defense)}</p>{/if}
	<p>{PTS_BASIS}</p>
	{#if facts}<p>{facts}</p>{/if}
</div>

<style>
	.basis {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-width: 72ch;
	}

	p {
		margin: 0;
		font-size: var(--t-sm);
		line-height: 1.45;
		color: var(--ink-3);
	}
</style>
