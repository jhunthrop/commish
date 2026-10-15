<script lang="ts">
	import type { Snippet } from 'svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import Basis from './Basis.svelte';
	import { LINES } from './words.ts';

	/** An in-season screen's body: its decision in one sentence first, with the one verb at the
	 * right (the host's page where the member acts, in a new tab: we never write a host), what the
	 * rows are ranked by, then the rows. On a phone the verb is pinned above the tab bar, so it is
	 * never a scroll away from the row that set it. */
	interface Props {
		decision: string;
		/** The fact that tipped it, under the decision. */
		reason?: string | null;
		verb: string;
		/** The host's page; empty when the API knows none, and the verb stands disabled. */
		href: string;
		/** The API's line on how the rows are ranked. */
		basis: string;
		children: Snippet;
	}

	let { decision, reason = null, verb, href, basis, children }: Props = $props();

	/** The verb's link opens the host in a new tab with no hold on this page. Set here rather than
	 * on the shared verb, so no other page carries it; made again for each host page, so a link that
	 * replaces the disabled verb takes it too. */
	function toHost(page: string): (holder: HTMLElement) => void {
		return (holder) => {
			if (page === '') return;
			const link = holder.querySelector('a');
			link?.setAttribute('target', '_blank');
			link?.setAttribute('rel', 'noopener');
		};
	}
</script>

<Panel as="section" label={LINES.ourCall} edge="accent">
	<div class="decision">
		<div class="words" role="status">
			<p class="line">{decision}</p>
			{#if reason}<p class="reason">{reason}</p>{/if}
		</div>
		<span class="verb desk" {@attach toHost(href)}
			><Verb {href} disabled={href === ''}>{verb}</Verb></span
		>
	</div>
</Panel>
<Basis {basis} />
{@render children()}
<div class="pin" {@attach toHost(href)}>
	<Verb {href} fill disabled={href === ''}>{verb}</Verb>
</div>

<style>
	.decision {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-4);
	}

	.words {
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
		min-width: 0;
	}

	.line {
		margin: 0;
		max-width: 72ch;
		font-size: var(--t-lg);
		font-weight: 600;
		line-height: 1.35;
	}

	.reason {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--t-sm);
	}

	.verb {
		flex: none;
	}

	.pin {
		display: none;
	}

	@media (max-width: 760px) {
		.line {
			font-size: var(--t-md);
		}

		.desk {
			display: none;
		}

		.pin {
			display: block;
			position: sticky;
			bottom: calc(var(--tab-bar-h) + env(safe-area-inset-bottom, 0px));
			z-index: 10;
			margin: 0 calc(var(--s-4) * -1);
			padding: var(--s-3) var(--s-4);
			background: var(--surface);
			border-top: 1px solid var(--line-strong);
		}
	}
</style>
