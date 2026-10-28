<script lang="ts">
	import type { Snippet } from 'svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import Basis from './Basis.svelte';
	import { hostTab } from './attach.ts';
	import { LINES } from './words.ts';

	/** An in-season screen's body: its decision in one sentence first, with the one verb at the
	 * right (the host's page where the member acts, in a new tab; or, where the API opens the move,
	 * a button that opens the confirmation on this screen), what the rows are ranked by, then the
	 * rows. On a phone the verb is pinned above the tab bar, so it is never a scroll away from the
	 * row that set it. */
	interface Props {
		decision: string;
		/** The fact that tipped it, under the decision. */
		reason?: string | null;
		/** The one verb; null where there is nothing to do (the Lineup already set). */
		verb: string | null;
		/** The host's page; empty when the API knows none, and the verb stands disabled. */
		href: string;
		/** The API's sentence under a verb it cannot open: where the member makes the change. */
		hostNote?: string | null;
		/** The API's line on how the rows are ranked, above them; null where the screen says it in its
		 * own basis block under the rows (the Trades table, Lane 66g). */
		basis: string | null;
		/** When set, the verb is a button that does this (opens the move's confirmation) rather than
		 * the host's page. */
		onverb?: (() => void) | null;
		/** The confirmation the verb opens: its id, and whether it is open (the screen's verb steps
		 * aside while it is, so one verb shows). */
		controls?: string;
		expanded?: boolean;
		/** A panel under the decision that carries the screen's verb itself (the trade builder): the
		 * screen's verb steps aside while it is open, so one verb shows. */
		panelVerb?: boolean;
		/** The confirmation, under the decision. */
		move?: Snippet;
		/** Under the verb in place of hostNote: its second half (the platform's page) and its line. */
		verbFoot?: Snippet;
		/** Whether verbFoot has anything to say now; false keeps an empty bar off a phone. */
		footSays?: boolean;
		/** Whether the verb sits beside the decision on a wide screen; false where the strip carries a
		 * verb on each card (Waivers, Lane 66f), the verb pinned on a phone alone. */
		deskVerb?: boolean;
		/** Whether the verb pins above the tab bar on a phone; false on a page whose own verb is the one
		 * verb (the every-league Lineup, Lane 257), where the screen draws no verb on a phone. */
		pin?: boolean;
		/** The decision drawn as a strip (the Lineup's swaps as chips, Lane 66e) in place of its
		 * sentence; the sentence stays the strip's name for a screen reader. */
		summary?: Snippet;
		children: Snippet;
	}

	let {
		decision,
		reason = null,
		verb,
		href,
		hostNote = null,
		basis,
		onverb = null,
		controls,
		expanded,
		panelVerb = false,
		move,
		summary,
		verbFoot,
		footSays = true,
		deskVerb = true,
		pin = true,
		children
	}: Props = $props();

	/** While the confirmation (or a panel with the verb) is open its own verb is the one on screen. */
	const asideForMove = $derived((onverb !== null && expanded === true) || panelVerb);
</script>

{#snippet action(fill: boolean)}
	{#if verb === null}
		<!-- Nothing to do: the line under it says so. -->
	{:else if onverb}
		<Verb onclick={onverb} {fill} {controls} {expanded}>{verb}</Verb>
	{:else}
		<Verb {href} {fill} disabled={href === ''}>{verb}</Verb>
	{/if}
{/snippet}

{#snippet foot(pinned: boolean)}
	{#if verbFoot}{@render verbFoot()}{:else if hostNote}{#if pinned}<p class="note">
				{hostNote}
			</p>{:else}<span class="note">{hostNote}</span>{/if}{/if}
{/snippet}

<Panel as="section" label={LINES.ourCall} edge="accent">
	<div class="decision">
		<div
			class="words"
			class:strip={summary !== undefined}
			role="status"
			aria-label={summary ? decision : undefined}
		>
			{#if summary}{@render summary()}{:else}<p class="line">{decision}</p>{/if}
			{#if reason}<p class="reason">{reason}</p>{/if}
		</div>
		{#if !asideForMove && deskVerb}
			<span class="verb desk" {@attach hostTab(href)}
				>{@render action(false)}
				{@render foot(false)}</span
			>
		{/if}
	</div>
</Panel>
{@render move?.()}
{#if basis !== null}<Basis {basis} />{/if}
{@render children()}
{#if pin && !asideForMove && (verb !== null || (verbFoot !== undefined && footSays) || hostNote !== null)}
	<div class="pin" {@attach hostTab(href)}>
		{@render action(true)}
		{@render foot(true)}
	</div>
{/if}

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

	.strip {
		flex: 1;
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
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--s-1);
		max-width: 22em;
	}

	.note {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--t-sm);
		text-align: right;
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

		.pin .note {
			margin-top: var(--s-1);
			text-align: center;
		}
	}
</style>
