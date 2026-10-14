// Disney's own sign-in for ESPN, run in a window of its own (espn-connect.html, under the CSP in
// web/_headers). It hands what Disney answers back to the page that opened it, on our origin
// alone, and never posts anywhere itself: the opener picks out the two ESPN values and sends them
// to the API (web/src/lib/hosts/espn-oneid.ts).
'use strict';

(() => {
	const ONEID_SCRIPT = 'https://cdn.registerdisney.go.com/v4/OneID.js';
	const ESPN_CLIENT_ID = 'ESPN-ONESITE.WEB-PROD';
	const RESPONDER = '/espn-responder';
	const KIND = 'commish-espn';
	const line = document.getElementById('line');
	const closeButton = document.getElementById('close');

	/** A copy that crosses windows: plain data only. */
	function plain(value) {
		try {
			return JSON.parse(JSON.stringify(value ?? null));
		} catch {
			return null;
		}
	}

	/** Hands the outcome to the opener, on our own origin only, and closes. */
	function send(outcome) {
		if (window.opener && !window.opener.closed) {
			window.opener.postMessage({ kind: KIND, ...outcome }, window.location.origin);
		}
		window.close();
	}

	closeButton.addEventListener('click', () => send({ outcome: 'closed' }));

	const script = document.createElement('script');
	script.src = ONEID_SCRIPT;
	script.onerror = () => send({ outcome: 'failed' });
	script.onload = async () => {
		try {
			const widget = window.OneID.get({
				clientId: ESPN_CLIENT_ID,
				responderPage: window.location.origin + RESPONDER
			});
			await widget.init();
			widget.on('login', async (login) => {
				const guest = await widget.getGuest().catch(() => null);
				send({ outcome: 'signed-in', payload: plain({ login, guest }) });
			});
			await widget.launchLogin();
			line.textContent = 'Sign in on the form above. Closing this window goes back.';
		} catch {
			send({ outcome: 'failed' });
		}
	};
	document.head.appendChild(script);
})();
