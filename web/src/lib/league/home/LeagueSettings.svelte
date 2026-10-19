<script lang="ts">
	import { UNCOUNTED_ANCHOR } from '../uncounted.ts';
	import Quiet from '#lib/ui/Quiet.svelte';
	import type { LeagueHost, LeagueTerms } from '../api.ts';
	import {
		HOME,
		extraWords,
		ruleFigure,
		scoringLead,
		scoringView,
		settingsLink,
		shapeView,
		termsView,
		unstatedWords,
		type RuleLine
	} from './home.ts';

	/** The league's settings, read only (Lane 66i): its scoring in the setup page's groups with the
	 * kicking and defense rules in Lane 70b's words, the points-allowed and yards-allowed tiers as two
	 * ladders, the rules the platform scores beyond them, the roster's shape and the league's terms,
	 * with a link to the platform's own page. */
	interface Props {
		terms: LeagueTerms;
		host: LeagueHost;
		teams: number;
		/** The scoring rules our stats lack, which Avg and Last leave out; empty when none. */
		uncounted: readonly string[];
	}

	let { terms, host, teams, uncounted }: Props = $props();

	/** "Which five" asks for this card (?view=settings#uncounted): it is drawn only once the week's
	 * read lands, after the browser has looked for the anchor, so it shows itself as it is drawn. */
	function landOn(card: HTMLElement): void {
		if (window.location.hash === `#${UNCOUNTED_ANCHOR}`) card.scrollIntoView();
	}

	const scoring = $derived(
		terms.scoring ? scoringView(terms.scoring, terms.scoring_unstated) : null
	);
	const shape = $derived(shapeView(terms.roster));
	const facts = $derived(termsView(terms, teams));
</script>

{#snippet figure(points: number)}
	<span class="fig" class:neg={points < 0} class:zero={points === 0}>{ruleFigure(points)}</span>
{/snippet}

{#snippet rule(r: RuleLine)}
	<tr class:unstated={!r.stated}
		><td>{r.label}</td><td class="n"
			>{#if r.stated}{@render figure(r.points)}{/if}</td
		></tr
	>
{/snippet}

{#snippet ladder(title: string, rules: readonly RuleLine[])}
	<div class="card wide">
		<h3>{title}</h3>
		{#if rules.some((r) => !r.stated)}<p class="note">
				{unstatedWords(host, rules.filter((r) => !r.stated).length)}
			</p>{/if}
		<ul class="tiers">
			{#each rules as r (r.label)}
				<li class:unstated={!r.stated}>
					<span class="range">{r.label}</span>{#if r.stated}{@render figure(r.points)}{/if}
				</li>
			{/each}
		</ul>
	</div>
{/snippet}

<section class="settings" aria-label={HOME.settings}>
	<div class="lead">
		<div>
			<h2>{HOME.scoring}</h2>
			{#if scoring}<p>{scoringLead(scoring.count, host)}</p>{/if}
		</div>
		{#if terms.host_settings_url}
			<Quiet href={terms.host_settings_url} size="sm">{settingsLink(host)}</Quiet>
		{/if}
	</div>
	<div class="grid">
		<div class="scoring">
			{#if scoring}
				{#each scoring.groups as group (group.label)}
					<div class="card">
						<h3>{group.label}</h3>
						<table class="rules">
							<tbody>
								{#each group.rules as r (r.label)}{@render rule(r)}{/each}
							</tbody>
						</table>
						{#if group.unstated > 0}<p class="note">{unstatedWords(host, group.unstated)}</p>{/if}
					</div>
				{/each}
				{@render ladder(HOME.pointsAllowed, scoring.pointsAllowed)}
				{@render ladder(HOME.yardsAllowed, scoring.yardsAllowed)}
			{/if}
			{#if terms.scoring_extra.length > 0}
				<div class="card wide">
					<h3>{extraWords(host)}</h3>
					<table class="rules">
						<tbody>
							{#each terms.scoring_extra as r (r.rule)}
								<tr
									><td class="cap">{r.rule}</td><td class="n"
										>{#if r.points !== null}{@render figure(r.points)}{/if}</td
									></tr
								>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
		<div class="side">
			{#if uncounted.length > 0}
				<div class="card" id={UNCOUNTED_ANCHOR} {@attach landOn}>
					<h3>{HOME.uncounted}</h3>
					<p class="note">{HOME.uncountedLine}</p>
					<ul class="uncounted">
						{#each uncounted as rule (rule)}<li class="cap">{rule}</li>{/each}
					</ul>
				</div>
			{/if}
			<div class="card">
				<h3>{HOME.roster}</h3>
				<ul class="shape">
					{#each shape as s (s.label)}
						<li class:none={s.count === 0}><b>{s.count}</b><span>{s.label}</span></li>
					{/each}
				</ul>
			</div>
			<div class="card">
				<h3>{HOME.league}</h3>
				<table class="rules kv">
					<tbody>
						{#each facts as f (f.label)}
							<tr><td>{f.label}</td><td>{f.value}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>
</section>

<style>
	.lead {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--s-4);
		margin-bottom: var(--s-3);
	}

	h2 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-xl);
		text-transform: uppercase;
		letter-spacing: 0.02em;
		line-height: 1;
	}

	.lead p {
		margin: 4px 0 0;
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: var(--s-5);
		align-items: start;
	}

	.scoring {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--s-3);
		align-items: start;
	}

	.card {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: var(--s-3);
	}

	.wide {
		grid-column: 1 / -1;
	}

	h3 {
		margin: 0 0 var(--s-2);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-2);
	}

	.rules {
		width: 100%;
		border-collapse: collapse;
	}

	.rules td {
		padding: 5px 0;
		border-bottom: 1px solid var(--line);
		font-size: var(--t-sm);
	}

	.rules tr:last-child td {
		border-bottom: 0;
	}

	.n {
		text-align: right;
		width: 64px;
	}

	.uncounted {
		margin: var(--s-2) 0 0;
		padding: 0;
		list-style: none;
		font-size: var(--t-sm);
	}

	.uncounted li {
		padding: 5px 0;
		border-bottom: 1px solid var(--line);
	}

	.uncounted li:last-child {
		border-bottom: 0;
	}

	/* The in-season bases link here: the card lands clear of the sticky top bar. */
	#uncounted {
		scroll-margin-top: calc(var(--s-6) * 3);
	}

	.note {
		margin: var(--s-2) 0 0;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.unstated td:first-child,
	.unstated .range {
		color: var(--ink-3);
	}

	.cap::first-letter {
		text-transform: uppercase;
	}

	.fig {
		font-family: var(--font-num);
		font-size: var(--t-lg);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.fig.neg {
		color: var(--loss-ink);
	}

	.fig.zero {
		color: var(--ink-3);
	}

	.tiers {
		display: grid;
		grid-template-columns: repeat(10, minmax(0, 1fr));
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tiers li {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 6px 2px;
		border-radius: var(--r-sm);
		background: var(--bg);
		border: 1px solid var(--line);
	}

	.range {
		font-size: 10px;
		color: var(--ink-3);
		white-space: nowrap;
	}

	.tiers .fig {
		font-size: var(--t-xl);
		font-weight: 800;
		line-height: 1;
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
	}

	.shape {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.shape li {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 6px 0;
		border-radius: var(--r-sm);
		background: var(--bg);
		border: 1px solid var(--line);
	}

	.shape b {
		font-family: var(--font-num);
		font-size: var(--t-xl);
		font-weight: 800;
		line-height: 1;
	}

	.shape span {
		font-size: 10px;
		font-weight: 700;
		color: var(--ink-3);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.shape .none b {
		color: var(--ink-3);
		font-weight: 600;
	}

	.kv td:last-child {
		text-align: right;
		font-weight: 600;
	}

	@media (max-width: 1100px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 760px) {
		.lead {
			flex-direction: column;
			align-items: flex-start;
		}

		.scoring {
			grid-template-columns: minmax(0, 1fr);
		}

		.tiers {
			grid-template-columns: repeat(5, minmax(0, 1fr));
		}
	}
</style>
