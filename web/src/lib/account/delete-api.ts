/** The delete account page's calls (Lane 233): who is signed in, and POST /me/delete with the email
 * the member typed. A signed-out browser is an answer, not an error. */
import { ApiError, type ApiClient } from '#lib/api/client.ts';
import { hasSessionCookie } from '#lib/api/session.ts';
import { isSignedOut } from '#lib/api/status.ts';
import type { components } from '#lib/api/types.ts';

type Account = components['schemas']['Account'];
type AccountDeletion = components['schemas']['AccountDeletion'];

/** What the page knows about the reader, and the state after the verb. */
export type DeleteState =
	| { kind: 'signed-in'; email: string }
	| { kind: 'signed-out' }
	| { kind: 'deleted' }
	| { kind: 'offline' }
	| { kind: 'unreachable' };

/** Whether the typed email is the account's, the API's rule (deletion.Confirmed): no regard to case
 * or the spaces around it. The verb waits for it, so a stray tap deletes nothing. */
export function confirmed(typed: string, email: string): boolean {
	const t = typed.trim();
	return t !== '' && t.toLowerCase() === email.trim().toLowerCase();
}

export interface DeleteApi {
	load(): Promise<DeleteState>;
	/** Deletes the account; resolves once the API answered 204. */
	remove(email: string): Promise<void>;
}

export function deleteApi(client: ApiClient, online: () => boolean): DeleteApi {
	return {
		async load() {
			if (!hasSessionCookie()) return { kind: 'signed-out' };
			try {
				const account = await client.call<Account>('/me');
				return { kind: 'signed-in', email: account.email };
			} catch (error) {
				if (isSignedOut(error)) return { kind: 'signed-out' };
				if (error instanceof ApiError || error instanceof TypeError) {
					return online() ? { kind: 'unreachable' } : { kind: 'offline' };
				}
				throw error;
			}
		},
		async remove(email) {
			const body: AccountDeletion = { email };
			await client.call<null>('/me/delete', { method: 'POST', body });
		}
	};
}
