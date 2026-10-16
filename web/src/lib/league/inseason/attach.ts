/** The in-season panels' shared attachments: a panel taking the focus when it opens, and a host
 * page link opening in a new tab. One place, so the move panel, the trade builder and the screen's
 * verb keep one focus and one link rule. */

/** The panel takes the focus when it opens, so a keyboard or a phone lands on it. */
export function focusOnOpen(node: HTMLElement): void {
	node.focus({ preventScroll: true });
	node.scrollIntoView({ block: 'nearest' });
}

/** The link inside the holder opens the host's page in a new tab with no hold on this page. Made
 * again for each page, so a link that replaces a disabled verb takes it too; nothing for no page. */
export function hostTab(page: string): (holder: HTMLElement) => void {
	return (holder) => {
		if (page === '') return;
		const link = holder.querySelector('a');
		link?.setAttribute('target', '_blank');
		link?.setAttribute('rel', 'noopener');
	};
}
