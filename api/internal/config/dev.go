package config

import "strings"

// Dev is what only a development API may do, each refused outright in
// production so a stray variable can never turn one on there.
type Dev struct {
	// FakeBilling sells through the in-memory gateway with the
	// development checkout page (internal/billing/devcheckout.go), so
	// every billing flow is walked locally without Stripe keys.
	FakeBilling bool
	// CompanionReplay lets POST /companions replay a recorded host draft
	// one pick a second (internal/companion), so the companion's page is
	// built and shot without a live draft.
	CompanionReplay bool
	// FFPCBaseURL points the FFPC client at a stand-in for FFPC's site
	// (tools/ffpcfake, which serves the captured pages), so connecting,
	// attaching and the league page are walked locally without anyone's
	// FFPC sign-in. Empty means FFPC itself.
	FFPCBaseURL string
}

func (l *loader) dev(env Env) Dev {
	d := Dev{
		FakeBilling: l.flag("BILLING_FAKE"), CompanionReplay: l.flag("COMPANION_REPLAY"),
		FFPCBaseURL: strings.TrimRight(l.optional("FFPC_BASE_URL", ""), "/"),
	}
	if d.FFPCBaseURL != "" && !strings.HasPrefix(d.FFPCBaseURL, "http://localhost:") && !strings.HasPrefix(d.FFPCBaseURL, "http://127.0.0.1:") {
		l.invalid("FFPC_BASE_URL", "is a local stand-in for FFPC, http://localhost:<port>")
	}
	if env != EnvProduction {
		return d
	}
	if d.FakeBilling {
		l.invalid("BILLING_FAKE", "is a development checkout and is refused in production")
	}
	if d.CompanionReplay {
		l.invalid("COMPANION_REPLAY", "is a development replay and is refused in production")
	}
	if d.FFPCBaseURL != "" {
		l.invalid("FFPC_BASE_URL", "is a development stand-in and is refused in production")
	}
	return Dev{}
}
