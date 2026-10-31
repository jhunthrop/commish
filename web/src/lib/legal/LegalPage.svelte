<script lang="ts">
	import NotAffiliated from '#lib/league/NotAffiliated.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import type { HeadMarkup } from '#lib/site/head.ts';
	import Shell from '#lib/ui/Shell.svelte';
	import { sectionId, type LegalDoc } from './legal-doc.ts';
	import type { LegalHrefs } from './legal-hrefs.ts';

	/** A legal page (Lane 151): prerendered, its title, the draft note, the day it last changed, then
	 * its sections as heads and paragraphs at reading width. The words and their links come from the
	 * page's load, built at prerender. */
	interface Props {
		doc: LegalDoc;
		/** Where each linked place lives (legal-hrefs.ts). */
		hrefs: LegalHrefs;
		/** The page's head but its title, built at prerender (Lane 169). */
		head: HeadMarkup;
		/** The rail's week item, named at build in season (server/build-week.ts, Lane 143, B126). */
		weekLabel?: string | undefined;
	}

	let { doc, hrefs, head, weekLabel }: Props = $props();
</script>

<Shell title={doc.title} head={{ title: doc.title, markup: head }} active={null} {weekLabel}>
	<main class="legal">
		<p class="draft">{doc.draftNote}</p>
		<PageHead title={doc.title} lead={doc.lead} />
		<p class="changed">{doc.changed}</p>
		{#each doc.sections as section (section.head)}
			<section id={sectionId(section.head)}>
				<h2>{section.head}</h2>
				{#each section.paragraphs as paragraph, i (i)}
					<p>
						{#each paragraph as part, j (j)}{#if typeof part === 'string'}{part}{:else}<a
									href={hrefs[part.to]}>{part.text}</a
								>{/if}{/each}
					</p>
				{/each}
			</section>
		{/each}
		<footer class="foot"><NotAffiliated /></footer>
	</main>
</Shell>

<style>
	.legal {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		padding: var(--s-5);
		max-width: 72ch;
	}

	.draft {
		margin: 0;
		align-self: flex-start;
		padding: 2px var(--s-2);
		border: 1px solid var(--shell-line);
		border-radius: var(--r-sm);
		font-size: var(--t-sm);
		font-weight: 600;
		color: var(--ink-2);
	}

	.changed {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	section {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	h2 {
		margin: var(--s-2) 0 0;
		font-size: var(--t-md);
		font-weight: 700;
	}

	section p {
		margin: 0;
		font-size: var(--t-md);
		line-height: 1.55;
		color: var(--ink-2);
	}

	a {
		color: var(--accent-text);
	}

	.foot {
		margin-top: var(--s-4);
		padding-top: var(--s-3);
		border-top: 1px solid var(--shell-line);
	}

	@media (max-width: 760px) {
		.legal {
			padding: var(--s-4);
		}
	}
</style>
