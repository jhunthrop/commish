<script lang="ts">
	import { onMount } from 'svelte';
	import { PUBLIC_API_URL } from '$app/env/public';
	import { apiClient } from '#lib/api/client.ts';
	import { hasSessionCookie } from '#lib/api/session.ts';
	import { hostsApi, openHostsOf } from '#lib/hosts/api.ts';
	import { SWITCHED_SHUT, type OpenHosts } from '#lib/league/hosts.ts';
	import { links } from '#lib/site/links.ts';
	import Footnote from '#lib/ui/Footnote.svelte';
	import LineList from '#lib/ui/LineList.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import { freeSeasonAt, readFreeSeason } from './free-season.ts';
	import { ALWAYS_FREE, FREE_WORDS, freeSeasonLines, type FreeLine } from './words.ts';

	interface Props {
		/** The rail's week item, named at build in season (server/build-week.ts, Lane 143, B126). */
		weekLabel?: string | undefined;
		/** The free season at the build's clock, so the first paint says it (free-season.ts). */
		builtFree: boolean;
	}

	let { weekLabel, builtFree }: Props = $props();

	/** The free page (Lane 150): every account has every tool through the 2026 season, said once,
	 * with what that is and the one verb, and nothing on it sells. The build's clock paints it; in the
	 * browser the page's own clock and the API's optional flag (Lane 149) say it again. */
	const client = apiClient(PUBLIC_API_URL);

	let free = $derived(builtFree);
	/** Null until the browser says whether a session is held, so the verb is never the wrong one. */
	let signedIn = $state<boolean | null>(null);
	/** The switched platforms open here, shut until read, so a platform switched off is never named. */
	let openHosts = $state<OpenHosts>(SWITCHED_SHUT);

	const words = $derived(free ? FREE_WORDS.season : FREE_WORDS.always);
	const lines = $derived<readonly FreeLine[]>(free ? freeSeasonLines(openHosts) : ALWAYS_FREE);

	onMount(() => {
		// The page's clock, set when it opens.
		const now = new Date();
		signedIn = hasSessionCookie();
		free = freeSeasonAt(now);
		void readFreeSeason(() => client.call<unknown>('/billing/plans'), now).then(
			(answer) => (free = answer)
		);
		void hostsApi
			.connections()
			.then((hosts) => (openHosts = openHostsOf(hosts)))
			.catch(() => (openHosts = SWITCHED_SHUT));
	});
</script>

<svelte:head>
	<title>{words.title} · Commish</title>
	<meta name="description" content={words.description} />
</svelte:head>

<Shell title={words.title} active="account" {weekLabel}>
	<main class="free">
		<PageHead title={words.title} />
		<Panel as="section" label={words.title}>
			<div class="lead">
				<div class="said">
					<p class="line">{words.lead}</p>
					<p class="note">{FREE_WORDS.note}</p>
				</div>
				<div class="verb">
					{#if signedIn === true}
						<Verb href={links.leagueNew()} size="lg" fill>{FREE_WORDS.follow}</Verb>
					{:else if signedIn === false}
						<Verb href={client.signInUrl(links.leagueNew())} size="lg" fill
							>{FREE_WORDS.signIn}</Verb
						>
					{/if}
				</div>
			</div>
		</Panel>
		<section aria-label={words.listHead}>
			<PanelHead title={words.listHead} level={2} />
			<LineList
				label={words.listHead}
				lines={lines.map((line) => ({
					lead: line.lead,
					text: line.text,
					href: sectionHref(line.section)
				}))}
			/>
		</section>
		{#if free}<Footnote>{FREE_WORDS.later}</Footnote>{/if}
	</main>
</Shell>

<style>
	.free {
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		padding: var(--s-5);
		max-width: 1040px;
	}

	.lead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-4);
	}

	.said {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	.line {
		margin: 0;
		font-size: var(--t-lg);
		font-weight: 600;
		color: var(--ink);
	}

	.note {
		margin: 0;
		font-size: var(--t-md);
		color: var(--ink-2);
	}

	/* The verb's room is held before the browser says which it is, so nothing moves when it lands. */
	.verb {
		min-width: 12rem;
		min-height: 48px;
		display: flex;
		justify-content: flex-end;
	}

	@media (max-width: 760px) {
		.free {
			padding: var(--s-4);
			gap: var(--s-4);
		}

		.lead {
			flex-direction: column;
			align-items: stretch;
		}

		.verb {
			min-width: 0;
		}
	}
</style>
