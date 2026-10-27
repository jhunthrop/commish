// The delete account's parity: the web's sign-in line and confirmation rule over the fixture account,
// the file the apps' delete sheets are held to. Run with `node --test shared/scripts/*.test.ts`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCOUNT_DELETE_OUTPUT } from './account-delete-parity.ts';
import { generate } from './export-parity.ts';

void test('the delete parity names who is signed in and confirms only the account email', async () => {
	const parity = JSON.parse((await generate()).get(ACCOUNT_DELETE_OUTPUT) ?? '{}') as {
		email: string;
		signedIn: string;
		confirm: { typed: string; confirmed: boolean }[];
	};
	assert.equal(parity.signedIn, `Signed in as ${parity.email}`);
	assert.equal(parity.confirm.length, 7);
	assert.deepEqual(
		parity.confirm.filter((c) => c.confirmed).map((c) => c.typed.trim().toLowerCase()),
		[parity.email, parity.email]
	);
	assert.ok(parity.confirm.some((c) => c.typed === '' && !c.confirmed));
});
