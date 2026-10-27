/** The delete account's parity (Lane 237): what the web's delete page builds over the fixture account,
 * which the apps' confirmation sheets are held to. The line naming who is signed in
 * (DeleteView.svelte: DELETE_WORDS.signedInAs, then the email), and the confirmation rule
 * (delete-api.ts confirmed, the API's deletion.Confirmed) over typed emails: empty, blank, partial,
 * another address, the address in another case with spaces around it, and the address itself. */
import type { Account } from '../../web/src/lib/account/account-api.ts';
import { confirmed } from '../../web/src/lib/account/delete-api.ts';
import { DELETE_WORDS } from '../../web/src/lib/account/delete-words.ts';

export const ACCOUNT_DELETE_OUTPUT = 'shared/fixtures/parity/account-delete.json';

/** What a member might type, each against the fixture account's email. */
export function typedCases(email: string): readonly string[] {
	const [name = ''] = email.split('@');
	return [
		'',
		'   ',
		name,
		email.slice(0, -1),
		`other${email}`,
		` ${email.toUpperCase()} `,
		email
	];
}

/** The parity file over the fixture account. */
export function renderAccountDelete(about: string, me: Account): string {
	const parity = {
		about,
		email: me.email,
		signedIn: `${DELETE_WORDS.signedInAs} ${me.email}`,
		confirm: typedCases(me.email).map((typed) => ({
			typed,
			confirmed: confirmed(typed, me.email)
		}))
	};
	return `${JSON.stringify(parity, null, '\t')}\n`;
}
