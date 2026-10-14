package config

import (
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
)

// Hosts is reading a member's own league on another host as them (FFPC,
// founder ruling 2026-10-13).
type Hosts struct {
	// FFPCEnabled is HOST_FFPC_ENABLED, the switch that turns FFPC off in
	// one deploy: the connect routes, the league poller's FFPC host, the
	// refresh job, the companion and the web's FFPC choice all read it. On
	// unless set false (the founder accepted the terms risk in writing).
	FFPCEnabled bool
	// YahooEnabled is HOST_YAHOO_ENABLED, Yahoo's switch: the connect
	// routes, the league poller's Yahoo host and the web's Yahoo choice
	// read it. On unless set false; Yahoo opens only with the app's id and
	// secret (YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET from Secret Manager)
	// present too.
	YahooEnabled      bool
	YahooClientID     string
	YahooClientSecret string
	// Keys wrap each connected account's own data key: KeyVersion is the
	// current key's version (HOST_CREDENTIALS_KEY_VERSION, 1 unless set),
	// Key is HOST_CREDENTIALS_KEY, and Previous is
	// HOST_CREDENTIALS_KEY_PREVIOUS, the key one version back, set only
	// while a rotation's re-encrypt job runs.
	KeyVersion int
	Key        []byte
	Previous   []byte
}

// hostKeyLen is the host credentials key's length: AES-256.
const hostKeyLen = 32

func (l *loader) hosts(env Env) Hosts {
	h := Hosts{FFPCEnabled: l.hostSwitch("HOST_FFPC_ENABLED"), YahooEnabled: l.hostSwitch("HOST_YAHOO_ENABLED"), KeyVersion: 1}
	h.YahooClientID = strings.TrimSpace(l.get("YAHOO_CLIENT_ID"))
	h.YahooClientSecret = strings.TrimSpace(l.get("YAHOO_CLIENT_SECRET"))
	if (h.YahooClientID == "") != (h.YahooClientSecret == "") {
		l.invalid("YAHOO_CLIENT_SECRET", "comes with YAHOO_CLIENT_ID: set both or neither")
	}
	if v := strings.TrimSpace(l.get("HOST_CREDENTIALS_KEY_VERSION")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 1000 {
			l.invalid("HOST_CREDENTIALS_KEY_VERSION", "must be a whole number from 1")
		}
		h.KeyVersion = n
	}
	h.Key = l.hostKey("HOST_CREDENTIALS_KEY")
	h.Previous = l.hostKey("HOST_CREDENTIALS_KEY_PREVIOUS")
	if h.Key == nil && env == EnvProduction && (h.FFPCEnabled || h.YahooEnabled) {
		l.errs = append(l.errs, &VarError{Name: "HOST_CREDENTIALS_KEY", Err: ErrMissing,
			Reason: "production with a host switched on (HOST_FFPC_ENABLED, HOST_YAHOO_ENABLED) keeps connected host accounts encrypted under it"})
	}
	if h.Previous != nil && h.KeyVersion < 2 {
		l.invalid("HOST_CREDENTIALS_KEY_PREVIOUS", "needs HOST_CREDENTIALS_KEY_VERSION of 2 or more")
	}
	return h
}

// hostSwitch is one host's switch: on unless set false.
func (l *loader) hostSwitch(name string) bool {
	v := strings.TrimSpace(l.get(name))
	if v == "" {
		return true
	}
	on, err := strconv.ParseBool(v)
	if err != nil {
		l.invalid(name, "must be true or false")
	}
	return on
}

// YahooConfigured reports whether the app's Yahoo id and secret are set.
func (h Hosts) YahooConfigured() bool { return h.YahooClientID != "" && h.YahooClientSecret != "" }

// hostKey reads one key, base64 of 32 random bytes, from Secret Manager in
// production. Its value is never echoed.
func (l *loader) hostKey(name string) []byte {
	raw := strings.TrimSpace(l.get(name))
	if raw == "" {
		return nil
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(key) != hostKeyLen {
		l.invalid(name, fmt.Sprintf("must be base64 of %d random bytes", hostKeyLen))
		return nil
	}
	return key
}

// Ring is the keys by version, for the vault.
func (h Hosts) Ring() (current int, byVersion map[int][]byte) {
	byVersion = map[int][]byte{}
	if h.Key != nil {
		byVersion[h.KeyVersion] = h.Key
	}
	if h.Previous != nil {
		byVersion[h.KeyVersion-1] = h.Previous
	}
	return h.KeyVersion, byVersion
}
