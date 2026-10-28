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
	DesignationPairs(ctx context.Context, since time.Time) ([]boards.DesignationPair, error)
}

// Lineups is each account's starters by followed league.
// *leaguesync.Service implements it: one upstream read per league however
// many members follow it (the poller shares it).
type Lineups interface {
	Starters(ctx context.Context, accountID uuid.UUID) ([]leaguesync.LeagueStarters, error)
}

// Queue is the part of Store a producer writes through.
type Queue interface {
	PushAccounts(ctx context.Context, kind Kind, activeSince time.Time) ([]uuid.UUID, bool, error)
	Preferences(ctx context.Context, accountID uuid.UUID) (Preferences, error)
	Enqueue(ctx context.Context, rows []Notification) (int, error)
}

// DefaultMaxChangeAge is how far back a change is still news: every
// capture pair whose newer capture is inside it is compared, so a run
// that failed or was skipped is caught up by the next (review H2); a
// producer that first runs on captures from yesterday says nothing.
const DefaultMaxChangeAge = 3 * time.Hour

// StarterStatus is the first producer: after each hourly capture, a push
// for every account whose followed league starts a player whose status
// changed, one row per account, player and change.
type StarterStatus struct {
	Designations Designations
	Lineups      Lineups
	Queue        Queue
	Now          func() time.Time
	Log          *slog.Logger
	MaxChangeAge time.Duration
}

// Produced is one run's count.
type Produced struct {
	Pairs   int
	Changes int
	Queued  int
	// Skipped is the accounts whose lineups could not be read this run
	// (review L3); the next run's catch-up tries them again.
	Skipped int
	// NewerAt is the newest capture compared, nil with none in the window.
	NewerAt *time.Time
}

// pairChanges is one pair's changes.
type pairChanges struct {
	at      time.Time
	changes []Change
}

// Produce compares every capture pair in the window, oldest first, and
// queues the pushes. A change already queued adds nothing; a newer change
// for the same player gives up the older unsent row (TopicKey).
func (p *StarterStatus) Produce(ctx context.Context) (Produced, error) {
	now := p.Now()
	pairs, err := p.Designations.DesignationPairs(ctx, now.Add(-p.maxAge()))
	if err != nil {
		return Produced{}, err
	}
	var out Produced
	var found []pairChanges
	for _, pair := range pairs {
		out.Pairs++
		at := pair.NewerAt
		out.NewerAt = &at
		if c := Changes(pair); len(c) > 0 {
			out.Changes += len(c)
			found = append(found, pairChanges{at: pair.NewerAt, changes: c})
		}
	}
	if len(found) == 0 {
		return out, nil
	}
	accounts, full, err := p.Queue.PushAccounts(ctx, KindStarterStatus, now.Add(-auth.SessionTTL))
	if err != nil {
		return out, err
	}
	if full {
		p.Log.Warn("notify: starter status reached the account bound; accounts past it were left out", "bound", MaxPushAccounts)
	}
	for _, accountID := range accounts {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		n, read, err := p.produceFor(ctx, accountID, found, now)
		if err != nil {
			return out, err
		}
		if !read {
			out.Skipped++
		}
		out.Queued += n
	}
	return out, nil
}

func (p *StarterStatus) maxAge() time.Duration {
	return orDuration(p.MaxChangeAge, DefaultMaxChangeAge)
}

// produceFor queues one account's pushes: each changed player one of its
// leagues starts, once however many leagues start him, pair by pair.
// read is false when its lineups could not be read.
func (p *StarterStatus) produceFor(ctx context.Context, accountID uuid.UUID, found []pairChanges, now time.Time) (int, bool, error) {
	leagues, err := p.Lineups.Starters(ctx, accountID)
	if err != nil {
		p.Log.Warn("notify: starters", "account_id", accountID, "err", err)
		return 0, false, nil
	}
	starts := startsByPlayer(leagues)
	prefs, err := p.Queue.Preferences(ctx, accountID)
	if err != nil {
		return 0, true, err
	}
	var rows []Notification
	for _, pc := range found {
		for _, c := range pc.changes {
			if in := starts[c.PlayerID]; len(in) > 0 {
				rows = append(rows, starterRow(accountID, c, in, pc.at, prefs.SendAfter(now)))
			}
		}
	}
	if len(rows) == 0 {
		return 0, true, nil
	}
	n, err := p.Queue.Enqueue(ctx, rows)
	return n, true, err
}

// start is one league that starts a player.
type start struct {
	league leaguesync.LeagueStarters
	player leaguesync.StartingPlayer
}

// startsByPlayer is the leagues that start each board id, in the
// account's own order.
func startsByPlayer(leagues []leaguesync.LeagueStarters) map[string][]start {
	out := map[string][]start{}
	for _, l := range leagues {
		for _, pl := range l.Players {
			out[pl.BoardID] = append(out[pl.BoardID], start{league: l, player: pl})
		}
	}
	return out
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
