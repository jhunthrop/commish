<script lang="ts">
	import { fixed } from '#lib/format/number.ts';
	import type { LeagueHost, LeagueTeam } from './api.ts';
	import { hostWords, recordWords } from './model.ts';

	/** The league's standings as one strip: each team's place, name, record and points for, yours
	 * marked. It wraps on a desk and scrolls sideways in a hand. */
	interface Props {
		teams: readonly LeagueTeam[];
		me: number;
		host: LeagueHost;
	}

	let { teams, me, host }: Props = $props();
</script>

<p class="order">Record, then points for. Points as {hostWords(host)} scores them.</p>
<ol class="strip" aria-label="Standings, by record then points for">
	{#each teams as team, i (team.roster_id)}
		<li
			class:mine={team.roster_id === me}
			aria-current={team.roster_id === me ? 'true' : undefined}
		>
			<span class="place">{i + 1}</span>
			<span class="name">{team.name}</span>
			<span class="rec">{recordWords(team)}</span>
			<span class="pf">{fixed(team.points_for)} pts</span>
		</li>
	{/each}
</ol>

<style>
	.order {
		margin: 0 0 calc(var(--s-2) * -1);
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.strip {
		list-style: none;
		margin: 0;
		padding: 0 0 var(--s-1);
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 1px;
		background: var(--line);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}

	li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		grid-template-areas: 'place name' 'rec pf';
		column-gap: var(--s-2);
		row-gap: 2px;
		padding: var(--s-2) var(--s-3);
		background: var(--surface);
	}

	.mine {
		background: var(--accent-wash);
	}

	.place {
		grid-area: place;
		font-family: var(--font-num);
		font-weight: 700;
		color: var(--ink-3);
	}

	.name {
		grid-area: name;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		unicode-bidi: isolate;
	}

	.rec,
	.pf {
		font-family: var(--font-num);
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.rec {
		grid-area: rec;
	}

	.pf {
		grid-area: pf;
		justify-self: end;
	}

	/* In a hand the strip is one row that scrolls sideways, so it never pushes the matchup down. */
	/* Twelve teams read as two rows of six on a desk. */
	@media (min-width: 1100px) {
		.strip {
			grid-template-columns: repeat(6, minmax(0, 1fr));
		}
	}

	@media (max-width: 760px) {
		.strip {
			grid-template-columns: none;
			grid-auto-flow: column;
			grid-auto-columns: minmax(150px, 1fr);
			overflow-x: auto;
		}
	}
</style>
