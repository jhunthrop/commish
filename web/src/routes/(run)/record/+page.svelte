<script lang="ts">
	import { siteContext } from '#lib/context/context.svelte.ts';
	import ContextNote from '#lib/context/ContextNote.svelte';
	import { recordLead } from '#lib/run/record.ts';
	import type { LeagueRecord, PlayersByWeek } from '#lib/run/record-league.ts';
	import { RECORDS_WORDS } from '#lib/run/records.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import DraftSection from './DraftSection.svelte';
	import WeeklySection from './WeeklySection.svelte';
	import './record.css';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** The run's record as written; its two records (Lane 114) once the run carries them. */
	const run = $derived(data.page.record);
	const weekly = $derived(data.page.weekly);
	const scoring = $derived(data.page.format.label);

	/** A selected league's record and the run's graded players (Lane 93), read once it is selected:
	 * starters right in the league's own lineup, and its own weekly record against ESPN. */
	let leagueRecord = $state<LeagueRecord | null>(null);
	let players = $state<PlayersByWeek>({});
	const leagueId = $derived(siteContext.league?.id ?? null);
	$effect(() => {
		const id = leagueId;
		leagueRecord = null;
		if (id === null) return;
		void import('#lib/league/record-api.ts').then(async (api) => {
			const [read, placed] = await Promise.all([api.readLeagueRecord(id), api.readRecordPlayers()]);
			if (leagueId !== id) return;
			players = placed;
			leagueRecord = read;
		});
	});
	/** The record is graded in one scoring: with a league selected, the page says the league's too. */
	const note = $derived.by(() => {
		const { league, notes } = siteContext;
		if (league === null || notes === null) return null;
		return `${notes.leagueScores(league)} Our record is graded in ${scoring}.`;
	});
</script>

<SiteShell title="Our record" run={data.run}>
	<main class="record">
		<PageHead
			title="Our record"
			lead={weekly === null ? recordLead(run, scoring) : RECORDS_WORDS.lead}
		/>
		<ContextNote {note} />
		{#if weekly === null}
			<!-- A run before Lane 114: its own record, drawn as it was, until the next run writes both. -->
			<WeeklySection
				record={run}
				fromWeek={null}
				unplayed={data.page.unplayed}
				underway={data.page.underway}
				{leagueRecord}
				{players}
				head={null}
				next={null}
			/>
		{:else}
			<WeeklySection
				record={weekly.record}
				fromWeek={weekly.fromWeek}
				unplayed={weekly.unplayed}
				underway={weekly.underway}
				{leagueRecord}
				{players}
				head={{ title: RECORDS_WORDS.weekly, what: RECORDS_WORDS.weeklyWhat }}
				next={weekly.next}
			/>
		{/if}
		<DraftSection draft={run.draft} {run} />
	</main>
</SiteShell>
