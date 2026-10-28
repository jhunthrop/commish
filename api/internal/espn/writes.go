package espn

// The one ESPN write the api makes: a lineup set on the member's own
// team, the move the member confirmed on our screen (spec 2026-10-15
// §10.2; docs/research/2026-10-15-host-writes-design.md §1). One POST of
// a ROSTER transaction with LINEUP items to the write host, with the
// member's two cookies; ESPN has no dry run and no idempotency key, so a
// write is sent once and never again on its own, and a lost answer is
// read back, not retried.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// DefaultWriteBase is ESPN's league write host: a different host from the
// reads (a GET on it answers 405).
const DefaultWriteBase = "https://lm-api-writes.fantasy.espn.com"

// The headers ESPN's own web app sends on a write (krmisystems
// ESPN_HTTP_COMPATIBILITY.md lines 109-118): optional for a lineup write,
// sent for parity.
const (
	fantasySource   = "kona"
	fantasyPlatform = "espn-fantasy-web"
)

// Bounds on a write.
const (
	// maxWriteAnswer is the most of ESPN's answer a write reads.
	maxWriteAnswer = 64 << 10
	// maxLineupItems bounds one move: a whole lineup changes in under 20.
	maxLineupItems = 20
	// rosterBody bounds the read-back of the rosters alone.
	rosterBody = 4 << 20
)

// ESPN's two lineup slots that start nobody.
const (
	SlotBench   = 20
	SlotReserve = 21
)

// SlotID is a lineup slot's lineupSlotId by our name for it (SlotName's
// inverse).
func SlotID(name string) (int, bool) {
	for id, n := range slots {
		if n == name {
			return id, true
		}
	}
	return 0, false
}

// The ways a write is not made.
var (
	// ErrNotYourTeam is a move on a team the member's SWID does not own,
	// or a player not on it: refused before anything is sent, even for a
	// commissioner's cookies, which ESPN would honor on any team.
	ErrNotYourTeam = errors.New("espn: not the member's own team")
	// ErrBadMove is a move ESPN would refuse whole: a locked player, a
	// slot he cannot fill or does not start from, an item that does not
	// move, a player twice.
	ErrBadMove = errors.New("espn: the move cannot be made")
	// ErrNotSent is a write that never left: no turn at the host, no
	// cookies, no request.
	ErrNotSent = errors.New("espn: the move was not sent")
)

// LineupItem is one player's move between lineup slots, by ESPN's ids.
type LineupItem struct {
	PlayerID string `json:"player_id"`
	From     int    `json:"from"`
	To       int    `json:"to"`
}

// LineupSet is a lineup move on the member's own team. Only OwnLineup
// makes one, so no write names a team the guard has not checked.
type LineupSet struct {
	leagueID string
	season   int
	team     int
	period   int
	items    []LineupItem
}

// Team is the member's team the move is on.
func (s LineupSet) Team() int { return s.team }

// Period is the scoring period the move is for: the league's current one.
func (s LineupSet) Period() int { return s.period }

// Items is the move's items.
func (s LineupSet) Items() []LineupItem { return append([]LineupItem(nil), s.items...) }

// OwnLineup checks a move against a fresh read of the league: team must
// be the one the caller names as the member's (the attached league's
// seat) and one the SWID owns, every item a player on that team in his
// From slot, unlocked, moving to a slot he may fill. The move is for the
// league's current scoring period.
func OwnLineup(l FullLeague, swid string, team int, items []LineupItem) (LineupSet, error) {
	t, ok := ownTeam(l, swid, team)
	if !ok {
		return LineupSet{}, fmt.Errorf("%w: team %d", ErrNotYourTeam, team)
	}
	if len(items) == 0 || len(items) > maxLineupItems {
		return LineupSet{}, fmt.Errorf("%w: %d items", ErrBadMove, len(items))
	}
	roster := map[string]Player{}
	for _, p := range t.Roster {
		roster[p.ID] = p
	}
	seen := map[string]bool{}
	for _, it := range items {
		p, on := roster[it.PlayerID]
		if !on {
			return LineupSet{}, fmt.Errorf("%w: player %s is not on team %d", ErrNotYourTeam, it.PlayerID, team)
		}
		if err := checkItem(p, it, seen); err != nil {
			return LineupSet{}, err
		}
	}
	return LineupSet{leagueID: l.ID, season: l.Season, team: team, period: l.ScoringPeriod, items: append([]LineupItem(nil), items...)}, nil
}

// ownTeam is the league's team with the id, when the SWID owns it.
func ownTeam(l FullLeague, swid string, team int) (Team, bool) {
	if !ValidSWID(swid) {
		return Team{}, false
	}
	for _, t := range l.Teams {
		if t.ID != team {
			continue
		}
		for _, o := range t.Owners {
			if strings.EqualFold(o, swid) {
				return t, true
			}
		}
	}
	return Team{}, false
}

func checkItem(p Player, it LineupItem, seen map[string]bool) error {
	switch {
	case seen[it.PlayerID]:
		return fmt.Errorf("%w: player %s twice", ErrBadMove, it.PlayerID)
	case it.From == it.To:
		return fmt.Errorf("%w: player %s stays in slot %d", ErrBadMove, it.PlayerID, it.To)
	case p.Slot != it.From:
		return fmt.Errorf("%w: player %s is in slot %d, not %d", ErrBadMove, it.PlayerID, p.Slot, it.From)
	case p.Locked:
		return fmt.Errorf("%w: player %s is locked", ErrBadMove, it.PlayerID)
	case !CanFill(p, it.To):
		return fmt.Errorf("%w: player %s cannot fill slot %d", ErrBadMove, it.PlayerID, it.To)
	}
	seen[it.PlayerID] = true
	return nil
}

// CanFill reports whether ESPN lets the player fill the slot: the bench
// always, otherwise one of his eligible slots.
func CanFill(p Player, slot int) bool {
	if slot == SlotBench {
		return true
	}
	for _, s := range p.Eligible {
		if s == slot {
			return true
		}
	}
	return false
}

// wireLineupItem and wireLineupSet are the captured body (jwulff 05 §2.1,
// p3): no memberId, so the SWID never rides in a body we keep.
type wireLineupItem struct {
	PlayerID int    `json:"playerId"`
	Type     string `json:"type"`
	From     int    `json:"fromLineupSlotId"`
	To       int    `json:"toLineupSlotId"`
}

type wireLineupSet struct {
	IsLeagueManager bool             `json:"isLeagueManager"`
	TeamID          int              `json:"teamId"`
	Type            string           `json:"type"`
	ScoringPeriodID int              `json:"scoringPeriodId"`
	ExecutionType   string           `json:"executionType"`
	Items           []wireLineupItem `json:"items"`
}

// Body is the JSON ESPN takes for the move. It never holds a cookie.
func (s LineupSet) Body() ([]byte, error) {
	w := wireLineupSet{TeamID: s.team, Type: "ROSTER", ScoringPeriodID: s.period, ExecutionType: "EXECUTE"}
	for _, it := range s.items {
		id, err := strconv.Atoi(it.PlayerID)
		if err != nil {
			return nil, fmt.Errorf("%w: player id %q", ErrBadMove, it.PlayerID)
		}
		w.Items = append(w.Items, wireLineupItem{PlayerID: id, Type: "LINEUP", From: it.From, To: it.To})
	}
	b, err := json.Marshal(w)
	if err != nil {
		return nil, fmt.Errorf("espn: body: %w", err)
	}
	return b, nil
}

// WriteOutcome is what a sent write came to.
type WriteOutcome string

// The outcomes of a sent write.
const (
	// WriteExecuted is ESPN's 200 with status EXECUTED.
	WriteExecuted WriteOutcome = "executed"
	// WriteRefused is ESPN's refusal (a 4xx): nothing applied, the
	// transaction is atomic.
	WriteRefused WriteOutcome = "refused"
	// WritePending is ESPN's 200 with status PENDING: a waiver claim
	// taken into the league's queue, run when the league runs claims.
	WritePending WriteOutcome = "pending"
	// WriteUnknown is a write sent whose answer is lost or not one ESPN
	// documents as done or refused: read back, never retried.
	WriteUnknown WriteOutcome = "unknown"
)

// Refusal is ESPN's reason, its type (TRAN_LINEUP_LOCKED) and its words.
type Refusal struct {
	Type    string
	Message string
}

// WriteAnswer is a sent write's answer as parsed: ESPN's status (0 for
// none), the body sent, what it came to, the refusal, the transaction's
// id, and whether the acting member ESPN names is the SWID the move went
// out with. ESPN's raw answer is never kept: it may echo the member's
// SWID (memberId).
type WriteAnswer struct {
	Status        int
	Sent          []byte
	Outcome       WriteOutcome
	Refusal       Refusal
	TransactionID string
	Member        MemberCheck
}

// MemberCheck is how ESPN's memberId on an answer compares with the SWID
// the move was sent with.
type MemberCheck string

// The member checks.
const (
	MemberAbsent     MemberCheck = "absent"
	MemberMatched    MemberCheck = "matched"
	MemberMismatched MemberCheck = "mismatched"
)

// wireWriteAnswer is the part of ESPN's answer a write reads: a 200's
// transaction, or a refusal's messages and details (jwulff 05 §5.1).
type wireWriteAnswer struct {
	ID       string   `json:"id"`
	Status   string   `json:"status"`
	MemberID *string  `json:"memberId"`
	Messages []string `json:"messages"`
	Details  []struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"details"`
}

// SetLineup sends the move once, with the member's cookies. It answers
// ErrNotSent when nothing left; any request that left answers a
// WriteAnswer, never an error, so the caller always keeps what was sent.
// It never retries.
func (c *Client) SetLineup(ctx context.Context, cookies Cookies, set LineupSet) (WriteAnswer, error) {
	body, err := set.Body()
	if err != nil {
		return WriteAnswer{}, fmt.Errorf("%w: %w", ErrNotSent, err)
	}
	ans, err := c.send(ctx, cookies, set.leagueID, set.season, body)
	// A lineup set is executed or refused; PENDING is not an answer ESPN
	// documents for one, so it is read back like any other unknown.
	if ans.Outcome == WritePending {
		ans.Outcome = WriteUnknown
	}
	return ans, err
}

// send POSTs one transaction once with the member's cookies: ErrNotSent
// when nothing left, else what the answer came to. Never a retry.
func (c *Client) send(ctx context.Context, cookies Cookies, league string, season int, body []byte) (WriteAnswer, error) {
	if !cookies.Valid() {
		return WriteAnswer{}, fmt.Errorf("%w: no session", ErrNotSent)
	}
	req, err := c.writeRequest(ctx, league, season, body)
	if err != nil {
		return WriteAnswer{}, err
	}
	if c.Pace != nil {
		if err := c.Pace.Wait(ctx); err != nil {
			return WriteAnswer{}, fmt.Errorf("%w: no turn at ESPN: %w", ErrNotSent, err)
		}
	}
	req.Header.Set("Cookie", cookies.header())
	out := WriteAnswer{Sent: body, Outcome: WriteUnknown, Member: MemberAbsent}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return out, nil
	}
	defer func() { _ = resp.Body.Close() }()
	out.Status = resp.StatusCode
	answer, _ := io.ReadAll(io.LimitReader(resp.Body, maxWriteAnswer))
	return classify(out, answer, cookies), nil
}

// writeRequest is the POST for the move, with ESPN's headers and ours.
func (c *Client) writeRequest(ctx context.Context, league string, season int, body []byte) (*http.Request, error) {
	base := c.WriteBase
	if base == "" {
		base = DefaultWriteBase
	}
	if !leagueID.MatchString(league) || season < minSeason || season > maxSeason {
		return nil, fmt.Errorf("%w: league %q", ErrNotSent, league)
	}
	path := fmt.Sprintf("%s/apis/v3/games/ffl/seasons/%d/segments/0/leagues/%s/transactions/", base, season, league)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, path, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("%w: request: %w", ErrNotSent, err)
	}
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Fantasy-Source", fantasySource)
	req.Header.Set("X-Fantasy-Platform", fantasyPlatform)
	return req, nil
}

// classify reads ESPN's answer: a 200 EXECUTED is executed, a 4xx is a
// refusal in ESPN's words, anything else is not known. ESPN's words never
// carry a cookie out: each is cut from them.
func classify(out WriteAnswer, answer []byte, cookies Cookies) WriteAnswer {
	var w wireWriteAnswer
	parsed := json.Unmarshal(answer, &w) == nil
	if parsed && w.MemberID != nil && strings.TrimSpace(*w.MemberID) != "" {
		out.Member = MemberMismatched
		if SameSWID(*w.MemberID, cookies.SWID) {
			out.Member = MemberMatched
		}
	}
	secrets := secretsOf(cookies)
	switch {
	case out.Status == http.StatusOK && parsed && w.Status == "EXECUTED":
		out.Outcome, out.TransactionID = WriteExecuted, text(secrets.redact(w.ID))
	case out.Status == http.StatusOK && parsed && w.Status == "PENDING":
		out.Outcome, out.TransactionID = WritePending, text(secrets.redact(w.ID))
	case out.Status >= 400 && out.Status < 500:
		out.Outcome = WriteRefused
		if parsed {
			out.Refusal = refusal(w, secrets)
		}
	}
	return out
}

// SameSWID compares two SWIDs, with or without braces, in any case.
func SameSWID(a, b string) bool {
	trim := func(s string) string { return strings.ToLower(strings.Trim(strings.TrimSpace(s), "{}")) }
	return trim(a) != "" && trim(a) == trim(b)
}

// redacted stands in for a cookie in ESPN's words.
const redacted = "[redacted]"

// secrets matches the member's cookies in ESPN's words: espn_s2, and the
// SWID braced or bare, in any case. Nil when there is nothing to match.
type secrets struct{ pattern *regexp.Regexp }

func secretsOf(c Cookies) secrets {
	var quoted []string
	// Longest first, so a braced SWID is cut whole rather than its bare
	// middle alone.
	for _, secret := range []string{c.S2, c.SWID, strings.Trim(c.SWID, "{}")} {
		if secret != "" {
			quoted = append(quoted, regexp.QuoteMeta(secret))
		}
	}
	if len(quoted) == 0 {
		return secrets{}
	}
	return secrets{pattern: regexp.MustCompile(`(?i)(?:` + strings.Join(quoted, "|") + `)`)}
}

// redact cuts every cookie from ESPN's words. It runs on the words whole,
// before any length cut, so a cut never splits an echoed SWID.
func (s secrets) redact(words string) string {
	if s.pattern == nil {
		return words
	}
	return s.pattern.ReplaceAllLiteralString(words, redacted)
}

// maxRefusalRunes bounds ESPN's words we keep and show.
const maxRefusalRunes = 300

func refusal(w wireWriteAnswer, secrets secrets) Refusal {
	r := Refusal{}
	if len(w.Details) > 0 {
		r.Type, r.Message = w.Details[0].Type, w.Details[0].Message
	}
	if len(w.Messages) > 0 && strings.TrimSpace(w.Messages[0]) != "" {
		r.Message = w.Messages[0]
	}
	r.Type, r.Message = secrets.redact(r.Type), secrets.redact(r.Message)
	r.Type = bounded64(r.Type)
	m := []rune(strings.TrimSpace(r.Message))
	if len(m) > maxRefusalRunes {
		m = m[:maxRefusalRunes]
	}
	r.Message = string(m)
	return r
}

func bounded64(s string) string {
	if len(s) > 64 {
		return s[:64]
	}
	return s
}

type wireRosters struct {
	Teams []struct {
		ID     int `json:"id"`
		Roster struct {
			Entries []wireEntry `json:"entries"`
		} `json:"roster"`
	} `json:"teams"`
}

// Applied reads the team's roster back (view=mRoster) with the member's
// cookies and reports whether every player of the move is where it put
// him.
func (c *Client) Applied(ctx context.Context, cookies Cookies, set LineupSet) (bool, error) {
	slots, ok, err := c.rosterIDs(ctx, cookies, set.leagueID, set.season, set.team)
	if err != nil || !ok {
		return false, err
	}
	for _, it := range set.items {
		if at, on := slots[it.PlayerID]; !on || at != it.To {
			return false, nil
		}
	}
	return true, nil
}

// rosterIDs reads the team's roster (view=mRoster) with the member's
// cookies: each player's slot by his id, and whether the team was in the
// answer.
func (c *Client) rosterIDs(ctx context.Context, cookies Cookies, league string, season, team int) (map[string]int, bool, error) {
	if !leagueID.MatchString(league) {
		return nil, false, ErrNotALink
	}
	path := fmt.Sprintf("%s/apis/v3/games/ffl/seasons/%d/segments/0/leagues/%s?view=mRoster", c.Base, season, league)
	body, err := c.get(ctx, path, &cookies, rosterBody)
	if err != nil {
		return nil, false, err
	}
	var w wireRosters
	if err := json.Unmarshal(body, &w); err != nil {
		return nil, false, fmt.Errorf("%w: %w", ErrMalformed, err)
	}
	for _, t := range w.Teams {
		if t.ID != team {
			continue
		}
		slots := map[string]int{}
		for _, p := range rosterOf(t.Roster.Entries) {
			slots[p.ID] = p.Slot
		}
		return slots, true, nil
	}
	return nil, false, nil
}
