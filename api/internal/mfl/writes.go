package mfl

// The one MyFantasyLeague write the api makes: a lineup set on the
// member's own franchise, the move the member confirmed on our screen,
// through the documented import (TYPE=lineup with the league, the week
// and the starters as MyFantasyLeague player ids, the franchise the
// session's own). One POST
// with the session cookie; MyFantasyLeague has no dry run and no
// idempotency key, so a write is sent once and never again on its own,
// and a lost answer is read back, not retried.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Bounds on a write.
const (
	maxWriteAnswer  = 64 << 10
	maxRefusalRunes = 300
)

// The ways a write is not made.
var (
	// ErrBadMove is a lineup MyFantasyLeague would refuse whole: a player
	// twice, one on injured reserve or the taxi squad, more starters than
	// the league starts.
	ErrBadMove = errors.New("mfl: the lineup cannot be set")
	// ErrNotSent is a write that never left: no session, no turn, no
	// request.
	ErrNotSent = errors.New("mfl: the lineup was not sent")
)

// LineupSet is a lineup on the member's own franchise. Only OwnLineup
// makes one, so no write names a franchise the guard has not checked.
type LineupSet struct {
	leagueID  string
	server    string
	season    int
	week      int
	franchise int
	starters  []string
}

// Week is the week the lineup is for: MyFantasyLeague's current one.
func (s LineupSet) Week() int { return s.week }

// Franchise is the member's franchise the lineup is for.
func (s LineupSet) Franchise() int { return s.franchise }

// Starters is the lineup's starters.
func (s LineupSet) Starters() []string { return append([]string(nil), s.starters...) }

// OwnLineup checks a lineup against a fresh read of the member's team:
// franchise must be theirs (the attached league's seat and the one
// MyFantasyLeague lists for the session), every starter on the active
// roster once, no fewer than start now and exactly as many as the league
// starts when it says.
func OwnLineup(t TeamLineup, franchise int, starters []string) (LineupSet, error) {
	if t.Franchise != franchise || franchise < 1 {
		return LineupSet{}, fmt.Errorf("%w: franchise %d", ErrNotYourTeam, franchise)
	}
	// MyFantasyLeague takes STARTERS as the whole lineup: never fewer than
	// start now, nor than the league starts when it says.
	if len(starters) == 0 || len(starters) > maxRoster || len(starters) < len(t.Starters) ||
		(t.StarterCount > 0 && len(starters) != t.StarterCount) {
		return LineupSet{}, fmt.Errorf("%w: %d starters", ErrBadMove, len(starters))
	}
	active := setOf(t.Roster)
	held := setOf(append(append([]string(nil), t.Reserve...), t.Taxi...))
	seen := map[string]bool{}
	for _, id := range starters {
		switch {
		case seen[id]:
			return LineupSet{}, fmt.Errorf("%w: player %s twice", ErrBadMove, id)
		case held[id]:
			return LineupSet{}, fmt.Errorf("%w: player %s is held off the active roster", ErrBadMove, id)
		case !active[id]:
			return LineupSet{}, fmt.Errorf("%w: player %s is not on franchise %d", ErrNotYourTeam, id, franchise)
		}
		seen[id] = true
	}
	return LineupSet{leagueID: t.LeagueID, server: t.Server, season: t.Season, week: t.Week, franchise: franchise,
		starters: append([]string(nil), starters...)}, nil
}

func setOf(ids []string) map[string]bool {
	out := make(map[string]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out
}

// form is the import's parameters: never the session. FRANCHISE_ID is
// left out: MyFantasyLeague documents it as the commissioner's way to set
// another franchise, and an owner's session already names the franchise.
// The guard has checked that franchise is the attached seat, and the
// read-back checks the lineup landed on it.
func (s LineupSet) form() url.Values {
	return url.Values{"TYPE": {"lineup"}, "L": {s.leagueID}, "W": {strconv.Itoa(s.week)},
		"STARTERS": {strings.Join(s.starters, ",")}, "XML": {"1"}}
}

// Body is the import's parameters as the proof keeps them, JSON with
// MyFantasyLeague's names. It never holds the session.
func (s LineupSet) Body() ([]byte, error) {
	f := s.form()
	b, err := json.Marshal(map[string]string{"TYPE": f.Get("TYPE"), "L": f.Get("L"), "W": f.Get("W"),
		"STARTERS": f.Get("STARTERS")})
	if err != nil {
		return nil, fmt.Errorf("mfl: body: %w", err)
	}
	return b, nil
}

// WriteOutcome is what a sent write came to.
type WriteOutcome string

// The outcomes of a sent write.
const (
	// WriteDone is MyFantasyLeague's <status>OK</status>.
	WriteDone WriteOutcome = "done"
	// WriteRefused is MyFantasyLeague's <error>, or a 4xx: nothing set.
	WriteRefused WriteOutcome = "refused"
	// WriteUnknown is a write sent whose answer is lost or neither: read
	// back, never retried.
	WriteUnknown WriteOutcome = "unknown"
)

// WriteAnswer is a sent write's answer as parsed: the status (0 for
// none), the body as the proof keeps it, what it came to and
// MyFantasyLeague's words for a refusal, the session cut from them.
type WriteAnswer struct {
	Status  int
	Sent    []byte
	Outcome WriteOutcome
	Words   string
	// Lost is why an answer was not read, for the log: "request" when the
	// request did not complete, "read" when the body did not, "" when read.
	Lost string
}

// SetLineup sends the lineup once with the member's session, as a POST
// with the parameters in the body. It answers ErrNotSent when nothing
// left; any request that left answers a WriteAnswer, never an error. It
// never retries and never follows a redirect.
func (c *Client) SetLineup(ctx context.Context, sess Session, set LineupSet) (WriteAnswer, error) {
	body, err := set.Body()
	if err != nil {
		return WriteAnswer{}, fmt.Errorf("%w: %w", ErrNotSent, err)
	}
	if !sess.Valid() {
		return WriteAnswer{}, fmt.Errorf("%w: no session", ErrNotSent)
	}
	req, host, err := c.importRequest(ctx, set)
	if err != nil {
		return WriteAnswer{}, err
	}
	if err := c.wait(ctx, host); err != nil {
		return WriteAnswer{}, fmt.Errorf("%w: no turn at MyFantasyLeague: %w", ErrNotSent, err)
	}
	req.Header.Set("Cookie", sess.header())
	out := WriteAnswer{Sent: body, Outcome: WriteUnknown}
	resp, err := c.memberHTTP().Do(req)
	if err != nil {
		out.Lost = "request"
		return out, nil
	}
	defer func() { _ = resp.Body.Close() }()
	out.Status = resp.StatusCode
	answer, err := io.ReadAll(io.LimitReader(resp.Body, maxWriteAnswer))
	if err != nil {
		out.Lost = "read"
	}
	return classify(out, answer, sess), nil
}

// importRequest is the POST for the lineup on the league's server.
func (c *Client) importRequest(ctx context.Context, set LineupSet) (*http.Request, string, error) {
	if !ValidLeagueID(set.leagueID) || !ValidSeason(set.season) {
		return nil, "", fmt.Errorf("%w: league %q", ErrNotSent, set.leagueID)
	}
	base, err := c.serverBase(set.server)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %w", ErrNotSent, err)
	}
	u := base.JoinPath(strconv.Itoa(set.season), "import")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), strings.NewReader(set.form().Encode()))
	if err != nil {
		return nil, "", fmt.Errorf("%w: request: %w", ErrNotSent, err)
	}
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return req, base.Host, nil
}

// classify reads MyFantasyLeague's answer: a 200 with OK is done, an
// <error> or a 4xx is a refusal in its words, anything else is not known.
func classify(out WriteAnswer, answer []byte, sess Session) WriteAnswer {
	a := readAnswer(answer)
	switch {
	case out.Status == http.StatusOK && a.ok:
		out.Outcome = WriteDone
	case (out.Status == http.StatusOK && a.refused) || (out.Status >= 400 && out.Status < 500):
		out.Outcome = WriteRefused
		if a.refused {
			out.Words = bounded(redact(a.words, sess))
		}
	}
	return out
}

// RefusalWords is MyFantasyLeague's words in an answer, the session cut
// from them and bounded, for a test of what is kept.
func RefusalWords(answer []byte, sess Session) string {
	return bounded(redact(readAnswer(answer).words, sess))
}

// redact cuts the session from MyFantasyLeague's words, before any length
// cut, so a cut never splits an echoed session.
func redact(words string, sess Session) string {
	if sess.UserID == "" {
		return words
	}
	return strings.ReplaceAll(words, sess.UserID, redacted)
}

func bounded(words string) string {
	return cleanText(words, maxRefusalRunes)
}

// Applied reads the franchise's starters back with the session and
// reports whether they are the lineup's, in any order.
func (c *Client) Applied(ctx context.Context, sess Session, set LineupSet) (bool, error) {
	got, err := c.starters(ctx, sess, set.server, set.season, set.leagueID, set.week, set.franchise)
	if err != nil {
		return false, err
	}
	if len(got) != len(set.starters) {
		return false, nil
	}
	want := setOf(set.starters)
	for _, id := range got {
		if !want[id] {
			return false, nil
		}
	}
	return true, nil
}
