<script lang="ts">
	import type { LeagueHost } from '../api.ts';
	import type { PlayerLine, ProjectionScoring } from '../inseason/api.ts';
	import { EVIDENCE_BASIS, deltaBasis, factsReadLine, projBasis, ptsBasis } from './box.ts';

	/** What a box score's numbers are, said once under the boxes, one short line each: the projection
	 * with its scoring and read (defenses' scoring named only when a defense is on the screen), on the
	 * Lineup its change since the read before and the evidence columns, points so far with the
	 * member's platform named, and the Game cell's two figures with their read. */
	interface Props {
		/** The projection's read and scoring; null when the screen has no projection to speak of. */
		projection: { readAt: string | null; scoring: ProjectionScoring } | null;
		/** Every line the boxes drew. */
		lines: readonly PlayerLine[];
		/** The platform gives each player's points (else each team's total alone). */
		byPlayer: boolean;
		/** The member's platform, named where a line says where a figure comes from. */
		host: LeagueHost;
		/** The Lineup's evidence columns: when the snapshot before the projection's was read. */
		evidence?: { previousReadAt: string | null } | null;
	}

	let { projection, lines, byPlayer, host, evidence = null }: Props = $props();

	const defense = $derived(lines.some((l) => l.player.position === 'DEF'));
	const facts = $derived(factsReadLine(lines));
	const delta = $derived(evidence ? deltaBasis(evidence.previousReadAt) : null);
</script>

<div class="basis">
	{#if projection}<p>
			{[projBasis(projection.readAt, projection.scoring, defense), delta]
				.filter((said) => said !== null)
				.join(' ')}
		</p>{/if}
	{#if evidence}<p>{EVIDENCE_BASIS}</p>{/if}
	<p>{ptsBasis(byPlayer, host)}</p>
	{#if facts}<p>{facts}</p>{/if}
</div>

<style>
	.basis {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-width: 90ch;
	}

	p {
		margin: 0;
		font-size: var(--t-sm);
		line-height: 1.45;
		color: var(--ink-3);
	}
</style>
