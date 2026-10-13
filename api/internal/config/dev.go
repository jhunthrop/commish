package config

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
}

func (l *loader) dev(env Env) Dev {
	d := Dev{FakeBilling: l.flag("BILLING_FAKE"), CompanionReplay: l.flag("COMPANION_REPLAY")}
	if env != EnvProduction {
		return d
	}
	if d.FakeBilling {
		l.invalid("BILLING_FAKE", "is a development checkout and is refused in production")
	}
	if d.CompanionReplay {
		l.invalid("COMPANION_REPLAY", "is a development replay and is refused in production")
	}
	return Dev{}
}
