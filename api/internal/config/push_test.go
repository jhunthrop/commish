package config

import (
	"slices"
	"testing"
)

// Push sends nothing until it is configured: no FCM project, APNs off
// until its whole key is here (a part of it is an error), no internal
// caller; the callers list reads emails only.
func TestPushConfig(t *testing.T) {
	l := hostLoader(nil)
	p := l.push()
	if l.err() != nil || p.FCMProjectID != "" || p.APNsConfigured() || len(p.InternalCallers) != 0 || p.APNsTopic != defaultAPNsTopic {
		t.Fatalf("defaults %+v %v", p, l.err())
	}
	l = hostLoader(map[string]string{"APNS_KEY_ID": "K"})
	if l.push(); l.err() == nil {
		t.Fatal("a part of the APNs key was taken")
	}
	l = hostLoader(map[string]string{
		"FCM_PROJECT_ID": "trycommish", "APNS_KEY_ID": "K", "APNS_TEAM_ID": "T", "APNS_KEY": "pem",
		"INTERNAL_CALLERS": "research-runtime@trycommish.iam.gserviceaccount.com other@trycommish.iam.gserviceaccount.com",
	})
	p = l.push()
	if l.err() != nil || p.FCMProjectID != "trycommish" || !p.APNsConfigured() ||
		!slices.Equal(p.InternalCallers, []string{"research-runtime@trycommish.iam.gserviceaccount.com", "other@trycommish.iam.gserviceaccount.com"}) {
		t.Fatalf("configured %+v %v", p, l.err())
	}
	l = hostLoader(map[string]string{"INTERNAL_CALLERS": "Research <research-runtime@trycommish.iam.gserviceaccount.com>"})
	if l.push(); l.err() == nil {
		t.Fatal("a caller that is not a bare email was taken")
	}
}

// INTERNAL_CALLERS is space-separated: one entry, two, and surrounding
// whitespace read; a comma or a quote (what the deploy action would pass
// through) is refused, never half-read (re-review N2).
func TestInternalCallersSplitOnWhitespace(t *testing.T) {
	const a, b = "research-runtime@trycommish.iam.gserviceaccount.com", "other@trycommish.iam.gserviceaccount.com"
	for raw, want := range map[string][]string{a: {a}, a + " " + b: {a, b}, "  " + a + "\n\t" + b + " ": {a, b}} {
		l := hostLoader(map[string]string{"INTERNAL_CALLERS": raw})
		if p := l.push(); l.err() != nil || !slices.Equal(p.InternalCallers, want) {
			t.Fatalf("%q: %v %v", raw, p.InternalCallers, l.err())
		}
	}
	for _, raw := range []string{a + "," + b, `"` + a + `"`} {
		l := hostLoader(map[string]string{"INTERNAL_CALLERS": raw})
		if l.push(); l.err() == nil {
			t.Fatalf("%q was taken", raw)
		}
	}
}

// The push job's configuration loads with only its own variables: no
// WorkOS, no host credentials, no Stripe (re-review N3).
func TestLoadNotifyNeedsOnlyItsOwnVariables(t *testing.T) {
	vars := map[string]string{
		"APP_ENV": "production", "DATABASE_URL": "postgres://u:p@/commish?host=/cloudsql/trycommish:us-east1:commish-pg",
		"FCM_PROJECT_ID": "trycommish", "BOARD_SCHEMA": "research",
		"HOST_FFPC_ENABLED": "true", "HOST_ESPN_ENABLED": "true",
	}
	c, err := LoadNotify(func(name string) string { return vars[name] })
	if err != nil {
		t.Fatal(err)
	}
	if c.Push.FCMProjectID != "trycommish" || c.Database.URL == "" || c.Board.Schema != "research" || c.Push.APNsConfigured() {
		t.Fatalf("loaded %+v", c)
	}
	if _, err := LoadAPI(func(name string) string { return vars[name] }); err == nil {
		t.Fatal("the API's loader took the job's variables alone; the test means the narrow one")
	}
	delete(vars, "DATABASE_URL")
	if _, err := LoadNotify(func(name string) string { return vars[name] }); err == nil {
		t.Fatal("loaded without a database")
	}
}
