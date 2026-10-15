import type { Snippet } from 'svelte';

/** What Verb and Quiet share: a link when it goes somewhere, a button when it does something. */
export interface ActionProps {
	/** A link to another page. Without it the action is a button. */
	href?: string;
	onclick?: (event: MouseEvent) => void;
	/** The key that does the same thing, printed after the words: Enter, U. */
	key?: string;
	/** sm sits in a row, md in a bar, lg carries a call. */
	size?: 'sm' | 'md' | 'lg';
	/** Fill the width of whatever holds it. */
	fill?: boolean;
	disabled?: boolean;
	type?: 'button' | 'submit';
	/** The action opens something (a menu): whether it is open, and the id of what it opens. */
	expanded?: boolean;
	controls?: string;
	children: Snippet;
}
