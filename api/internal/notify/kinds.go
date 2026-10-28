// Package notify is push, the server side (spec §5.3, Lane 262): the
// outbox producers write to, the members' preferences, and the notify job
// that drains the outbox to FCM and APNs. Producers insert rows and never
// send; the job sends, retries with backoff up to a bound, and drops a
// token the platform says is dead.
package notify

// Kind is one kind of push, each with its own switch on the account.
type Kind string

// The kinds. The words are a contract with app.notifications' check, the
// preferences' kinds_off check and the wire's NotificationKinds.
const (
	// KindStarterStatus is a starter in a followed league ruled out,
	// doubtful, cleared, put on injured reserve or activated.
	KindStarterStatus Kind = "starter_status"
	// KindWeekReads is the week's reads landed on Thursday. TODO(Lane 256):
	// the producer, called from research/inseason/season_week.py after the
	// Thursday read pass; the kind and its switch exist so the apps can
	// show the switch now.
	KindWeekReads Kind = "week_reads"
	// KindWaiverClaims is a waiver claim in a followed league resolved.
	// TODO(no lane assigned yet; the league sync's claim producer): produced
	// where the league sync's read lands a resolved claim (leaguesync
	// Poller.Landed), the kind and its switch registered now.
	KindWaiverClaims Kind = "waiver_claims"
)

// Kinds is every kind, in the wire's order.
func Kinds() []Kind { return []Kind{KindStarterStatus, KindWeekReads, KindWaiverClaims} }

// Valid reports whether k is one of Kinds.
func (k Kind) Valid() bool {
	for _, known := range Kinds() {
		if k == known {
			return true
		}
	}
	return false
}
