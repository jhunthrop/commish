package config

import (
	"net/mail"
	"strings"
)

// Push is push delivery and the internal routes our jobs call (Lane 262).
type Push struct {
	// FCMProjectID is FCM_PROJECT_ID, the Firebase project FCM v1 sends
	// through with the runtime's own identity; empty sends nothing to FCM.
	FCMProjectID string
	// APNs is the token key, from Secret Manager once the Apple Developer
	// account issues it: APNS_KEY_ID, APNS_TEAM_ID and APNS_KEY (the .p8's
	// PEM). Until all three are here the APNs sender is not configured.
	APNsKeyID  string
	APNsTeamID string
	APNsKey    string
	// APNsTopic is APNS_TOPIC, the iOS app's bundle id.
	APNsTopic string
	// APNsSandbox is APNS_SANDBOX: Apple's sandbox, for a build from Xcode.
	APNsSandbox bool
	// InternalCallers are INTERNAL_CALLERS, space-separated service
	// accounts whose Google identity tokens open the internal routes (the
	// research runtime's, for the starter status request); none opens
	// nothing.
	InternalCallers []string
}

// defaultAPNsTopic is the iOS app's bundle id (infra/README.md, Firebase).
const defaultAPNsTopic = "app.trycommish.ios"

// APNsConfigured reports whether the whole token key is here.
func (p Push) APNsConfigured() bool {
	return p.APNsKeyID != "" && p.APNsTeamID != "" && p.APNsKey != ""
}

func (l *loader) push() Push {
	p := Push{
		FCMProjectID: l.optional("FCM_PROJECT_ID", ""),
		APNsKeyID:    l.optional("APNS_KEY_ID", ""),
		APNsTeamID:   l.optional("APNS_TEAM_ID", ""),
		APNsKey:      l.optional("APNS_KEY", ""),
		APNsTopic:    l.optional("APNS_TOPIC", defaultAPNsTopic),
		APNsSandbox:  l.flag("APNS_SANDBOX"),
	}
	set := 0
	for _, v := range []string{p.APNsKeyID, p.APNsTeamID, p.APNsKey} {
		if v != "" {
			set++
		}
	}
	if set > 0 && set < 3 {
		l.invalid("APNS_KEY_ID", "APNS_KEY_ID, APNS_TEAM_ID and APNS_KEY are set together or not at all")
	}
	// Separated by whitespace alone: the deploy action splits its list on
	// commas, so a comma never reaches here as a separator (re-review N2).
	for _, caller := range strings.Fields(l.get("INTERNAL_CALLERS")) {
		if addr, err := mail.ParseAddress(caller); err != nil || addr.Address != caller {
			l.invalid("INTERNAL_CALLERS", "every entry must be a service account email")
			continue
		}
		p.InternalCallers = append(p.InternalCallers, caller)
	}
	return p
}

// Notify is the push job's whole configuration (cmd/api notify): the
// database, the board it places starters on, and push delivery. It never
// reads the API's sign-in, billing or host credentials, so the job runs
// with DATABASE_URL alone mounted (re-review N3, security L5).
type Notify struct {
	Env      Env
	Database Database
	Board    Board
	Push     Push
}

// LoadNotify reads the push job's configuration.
func LoadNotify(get Getenv) (Notify, error) {
	l := &loader{get: get}
	c := Notify{Env: l.env()}
	c.Database = l.database()
	c.Board = l.board()
	c.Push = l.push()
	return c, l.err()
}
