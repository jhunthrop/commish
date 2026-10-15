package config

import (
	"encoding/base64"
	"strings"
	"testing"
)

func hostLoader(vars map[string]string) *loader {
	return &loader{get: func(name string) string { return vars[name] }}
}

// A host write's switch is off unless set true.
func TestWriteSwitchOffByDefault(t *testing.T) {
	if h := hostLoader(nil).hosts(EnvDevelopment); h.ESPNLineupWrites {
		t.Fatal("ESPN lineup writes on by default")
	}
	if h := hostLoader(map[string]string{"HOST_WRITES_ESPN_LINEUP": "true"}).hosts(EnvDevelopment); !h.ESPNLineupWrites {
		t.Fatal("ESPN lineup writes set true and off")
	}
	l := hostLoader(map[string]string{"HOST_WRITES_ESPN_LINEUP": "sometimes"})
	if l.hosts(EnvDevelopment); l.err() == nil {
		t.Fatal("a switch neither true nor false")
	}
}

// FFPC is on unless set false; production needs the key only when FFPC is
// on; the previous key needs a version to sit below.
func TestHostsSwitchAndKeys(t *testing.T) {
	key := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32)))

	l := hostLoader(nil)
	if h := l.hosts(EnvProduction); !h.FFPCEnabled || l.err() == nil {
		t.Fatalf("production with FFPC on and no key: enabled %v, err %v", h.FFPCEnabled, l.err())
	}
	l = hostLoader(map[string]string{"HOST_FFPC_ENABLED": "false"})
	if h := l.hosts(EnvProduction); h.FFPCEnabled || !h.YahooEnabled || l.err() == nil {
		t.Fatalf("production with Yahoo on and no key: ffpc %v, yahoo %v, err %v", h.FFPCEnabled, h.YahooEnabled, l.err())
	}
	l = hostLoader(map[string]string{"HOST_FFPC_ENABLED": "false", "HOST_YAHOO_ENABLED": "false"})
	if h := l.hosts(EnvProduction); !h.ESPNEnabled || l.err() == nil {
		t.Fatalf("production with ESPN on and no key: espn %v, err %v", h.ESPNEnabled, l.err())
	}
	l = hostLoader(map[string]string{"HOST_FFPC_ENABLED": "false", "HOST_YAHOO_ENABLED": "false", "HOST_ESPN_ENABLED": "false"})
	if h := l.hosts(EnvProduction); h.FFPCEnabled || h.YahooEnabled || h.ESPNEnabled || l.err() != nil {
		t.Fatalf("production with every host off and no key: enabled %v, err %v", h.FFPCEnabled, l.err())
	}
	l = hostLoader(map[string]string{"HOST_CREDENTIALS_KEY": key, "HOST_CREDENTIALS_KEY_VERSION": "2", "HOST_CREDENTIALS_KEY_PREVIOUS": key})
	h := l.hosts(EnvProduction)
	current, ring := h.Ring()
	if l.err() != nil || current != 2 || len(ring) != 2 || ring[1] == nil {
		t.Fatalf("a rotation's ring: current %d, %d keys, %v", current, len(ring), l.err())
	}
	l = hostLoader(map[string]string{"HOST_CREDENTIALS_KEY": key, "HOST_CREDENTIALS_KEY_PREVIOUS": key})
	if l.hosts(EnvDevelopment); l.err() == nil {
		t.Fatal("a previous key at version 1 was accepted")
	}
	l = hostLoader(map[string]string{"HOST_FFPC_ENABLED": "maybe"})
	if l.hosts(EnvDevelopment); l.err() == nil {
		t.Fatal("a switch that is not true or false was accepted")
	}
	l = hostLoader(map[string]string{"YAHOO_CLIENT_ID": "id"})
	if l.hosts(EnvDevelopment); l.err() == nil {
		t.Fatal("a Yahoo id with no secret was accepted")
	}
	l = hostLoader(map[string]string{"YAHOO_CLIENT_ID": "id", "YAHOO_CLIENT_SECRET": "secret"})
	if h := l.hosts(EnvDevelopment); !h.YahooConfigured() || l.err() != nil {
		t.Fatalf("the Yahoo app: %v", l.err())
	}
}

// ALLOWED_HOSTS defaults to API_BASE_URL's host; a set list splits on
// spaces or commas, lower-cased, and refuses a URL, a path or a wildcard.
func TestAllowedHosts(t *testing.T) {
	if got := hostLoader(nil).allowedHosts("https://api.trycommish.app"); len(got) != 1 || got[0] != "api.trycommish.app" {
		t.Fatalf("default = %v", got)
	}
	if got := hostLoader(nil).allowedHosts("http://localhost:8080"); len(got) != 1 || got[0] != "localhost" {
		t.Fatalf("default with a port = %v", got)
	}
	l := hostLoader(map[string]string{"ALLOWED_HOSTS": "api.trycommish.app API2.trycommish.app,"})
	got := l.allowedHosts("https://api.trycommish.app")
	if len(got) != 2 || got[0] != "api.trycommish.app" || got[1] != "api2.trycommish.app" || l.err() != nil {
		t.Fatalf("list = %v, %v", got, l.err())
	}
	for _, bad := range []string{"https://api.trycommish.app", "api.trycommish.app/x", "*.trycommish.app", "*"} {
		l := hostLoader(map[string]string{"ALLOWED_HOSTS": bad})
		if l.allowedHosts("https://api.trycommish.app"); l.err() == nil {
			t.Fatalf("%q was accepted", bad)
		}
	}
}
