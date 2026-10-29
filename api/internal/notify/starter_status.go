package notify

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// Designations is the capture pairs the producer compares.
// *boards.PGSource implements it.
type Designations interface {
	DesignationPairs(ctx context.Context, since time.Time) (boards.PairRead, error)
}

// Lineups is each account's starters by followed league.
// *leaguesync.Service implements it: one upstream read per league however
// many members follow it (the poller shares it).
type Lineups interface {
	Starters(ctx context.Context, accountID uuid.UUID) ([]leaguesync.LeagueStarters, error)
}

// Queue is the part of Store a producer writes through.
type Queue interface {
	PushAccounts(ctx context.Context, kind Kind, activeSince time.Time, after uuid.UUID) ([]uuid.UUID, bool, error)
	Preferences(ctx context.Context, accountID uuid.UUID) (Preferences, error)
	Enqueue(ctx context.Context, rows []Notification) (int, error)
}

// StarterStatus is the first producer: after each hourly capture, a push
// for every account whose followed league starts a player whose status
// changed, one row per account, player and change.
type StarterStatus struct {
	Designations Designations
	Lineups      Lineups
	Queue        Queue
	Now          func() time.Time
	Log          *slog.Logger
}

// Produced is one run's count.
type Produced struct {
	Pairs   int
	Changes int
	Queued  int
	// Skipped is the accounts whose lineups could not be read this run
	// (review L3): they miss this run's changes, which the mark moves past.
	Skipped int
	// StaleLeagues is the followed leagues whose kept read was too old to
	// be taken as the member's lineup (leaguesync.MaxStarterReadAge, re-review
	// N15): none of their starters is pushed.
	StaleLeagues int
	// NewerAt is the newest capture compared, nil with none after since.
	NewerAt *time.Time
	// Captures is the pair read's count and cut (boards.PairRead): a cut
	// read leaves the captures after CutAt for the next run.
	Captures, CapturesLeft int
	Cut                    bool
	CutAt                  time.Time
	// Accounts is the accounts walked to the end; LastAccount the last of
	// them, uuid.Nil with none. Done is a walk that reached the last
	// account owed, false when a run is cut or the page bound stops it.
	Accounts    int
	LastAccount uuid.UUID
	Done        bool
}

// Window is what one run produces for: the pairs whose newer capture is
// after Since and, when Until is set, at or before it, for the accounts
// after After (uuid.Nil: every account). A resumed run walks the window
// its cut run began (Lane 285, B275).
type Window struct {
	Since, Until time.Time
	After        uuid.UUID
}

// pairChanges is one pair's changes.
type pairChanges struct {
	at      time.Time
	changes []Change
}

// Produce compares every capture pair in the window, oldest first, and
// queues the pushes for the window's accounts in id order (the catch-up,
// CatchUp, picks the window from the producer's mark). The changes come
// first: with none, no account is walked; an account whose starters hold
// no changed player writes nothing and reads nothing more. A change
// already queued adds nothing; a newer change for the same player gives
// up the older unsent row (TopicKey). A run cut by ctx returns what it
// finished (Accounts, LastAccount) with the error, so the catch-up can
// resume after it.
func (p *StarterStatus) Produce(ctx context.Context, w Window) (Produced, error) {
	now := p.Now()
	read, err := p.Designations.DesignationPairs(ctx, w.Since)
	if err != nil {
		return Produced{}, err
	}
	out := Produced{Captures: read.Read, CapturesLeft: read.Left, Cut: read.Cut, CutAt: read.CutAt}
	found := p.windowChanges(read.Pairs, w, &out)
	if len(found) == 0 {
		out.Done = true
		return out, nil
	}
	accounts, full, err := p.Queue.PushAccounts(ctx, KindStarterStatus, now.Add(-auth.SessionTTL), w.After)
	if err != nil {
		return out, err
	}
	for _, accountID := range accounts {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		n, stale, read, err := p.produceFor(ctx, accountID, found, now)
		if err != nil {
			return out, err
		}
		if !read {
			out.Skipped++
		}
		out.Queued += n
		out.StaleLeagues += stale
		out.Accounts++
		out.LastAccount = accountID
	}
	out.Done = !full
	return out, nil
}

// windowChanges is the window's pairs' changes, counting its pairs and
// changes and the newest capture compared into out.
func (p *StarterStatus) windowChanges(pairs []boards.DesignationPair, w Window, out *Produced) []pairChanges {
	var found []pairChanges
	for _, pair := range pairs {
		if !w.Until.IsZero() && pair.NewerAt.After(w.Until) {
			continue
		}
		out.Pairs++
		at := pair.NewerAt
		out.NewerAt = &at
		if c := Changes(pair); len(c) > 0 {
			out.Changes += len(c)
			found = append(found, pairChanges{at: pair.NewerAt, changes: c})
		}
	}
	return found
}

// hit is one change one of an account's leagues starts.
type hit struct {
	at     time.Time
	change Change
	in     []start
}

// produceFor queues one account's pushes: each changed player one of its
// leagues starts, once however many leagues start him, pair by pair. Its
// preferences are read only when it starts a changed player. stale is its
// leagues whose kept read was too old; read is false when its lineups
// could not be read (a read cut by ctx is the run's error, never a skip).
func (p *StarterStatus) produceFor(ctx context.Context, accountID uuid.UUID, found []pairChanges, now time.Time) (int, int, bool, error) {
	leagues, err := p.Lineups.Starters(ctx, accountID)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return 0, 0, false, ctxErr
		}
		p.Log.Warn("notify: starters", "account_id", accountID, "err", err)
		return 0, 0, false, nil
	}
	starts, stale := startsByPlayer(leagues)
	var hits []hit
	for _, pc := range found {
		for _, c := range pc.changes {
			if in := starts[c.PlayerID]; len(in) > 0 {
				hits = append(hits, hit{at: pc.at, change: c, in: in})
			}
		}
	}
	if len(hits) == 0 {
		return 0, stale, true, nil
	}
	prefs, err := p.Queue.Preferences(ctx, accountID)
	if err != nil {
		return 0, stale, true, err
	}
	rows := make([]Notification, len(hits))
	for i, h := range hits {
		rows[i] = starterRow(accountID, h.change, h.in, h.at, prefs.SendAfter(now))
	}
	n, err := p.Queue.Enqueue(ctx, rows)
	return n, stale, true, err
}

// start is one league that starts a player.
type start struct {
	league leaguesync.LeagueStarters
	player leaguesync.StartingPlayer
}

// startsByPlayer is the leagues that start each board id, in the
// account's own order, and how many leagues were stale (none of whose
// starters counts).
func startsByPlayer(leagues []leaguesync.LeagueStarters) (map[string][]start, int) {
	out := map[string][]start{}
	stale := 0
	for _, l := range leagues {
		if l.Stale {
			stale++
			continue
		}
		for _, pl := range l.Players {
			out[pl.BoardID] = append(out[pl.BoardID], start{league: l, player: pl})
		}
	}
	return out, stale
}

// starterRow is one account's push for one change. Its dedupe key is the
// player, the change and the capture that showed it, so the same change
// is queued once however often the producer runs; its topic is the
// player. The deep link opens the first league's lineup on him.
func starterRow(accountID uuid.UUID, c Change, in []start, newerAt, sendAfter time.Time) Notification {
	first := in[0]
	title, body := starterWords(c.Change, first.player.Name, first.league.LeagueName, len(in))
	path := "/league/" + first.league.LinkID.String() + "/start?player=" + url.QueryEscape(c.PlayerID)
	return Notification{
		AccountID: accountID, Kind: KindStarterStatus, Title: title, Body: body, SendAfter: sendAfter,
		Data: map[string]string{
			DedupeKey:   fmt.Sprintf("%s:%s:%d", c.PlayerID, c.Change, newerAt.Unix()),
			TopicKey:    "player:" + c.PlayerID,
			TopicAtKey:  strconv.FormatInt(newerAt.Unix(), 10),
			"player_id": c.PlayerID, "league_id": first.league.LinkID.String(), "change": string(c.Change),
			"path": path,
		},
	}
}
