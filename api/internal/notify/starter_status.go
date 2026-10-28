package notify

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// StatusChange is how a player's status moved between two captures, the
// changes a starter's member hears about (spec §5.3, Lane 262).
type StatusChange string

// The changes. A newly questionable player is not one: the week is full
// of them, and the screens carry the word.
const (
	ChangeOut            StatusChange = "out"
	ChangeDoubtful       StatusChange = "doubtful"
	ChangeCleared        StatusChange = "cleared"
	ChangeInjuredReserve StatusChange = "injured_reserve"
	ChangeActivated      StatusChange = "activated"
)

// Change is one player's change.
type Change struct {
	PlayerID string
	Change   StatusChange
	From, To string
}

// weekStatuses are a week's designations: a player cleared of one is
// back for the week.
var weekStatuses = map[string]bool{
	boards.StatusQuestionable: true, boards.StatusDoubtful: true, boards.StatusOut: true,
}

// changeOf is the change from one status to the next ("" is not listed),
// false when the move is not one a member hears about.
func changeOf(from, to boards.Designation, listedBefore, listedNow bool) (StatusChange, bool) {
	was, is := "", ""
	if listedBefore {
		was = from.Status()
	}
	if listedNow {
		is = to.Status()
	}
	wasLong := listedBefore && from.SeasonLong()
	isLong := listedNow && to.SeasonLong()
	switch {
	case was == is:
		return "", false
	case is == boards.StatusInjuredReserve:
		return ChangeInjuredReserve, true
	case wasLong && !isLong:
		return ChangeActivated, true
	case is == boards.StatusOut && !wasLong:
		return ChangeOut, true
	case is == boards.StatusDoubtful:
		return ChangeDoubtful, true
	case is == "" && weekStatuses[was]:
		return ChangeCleared, true
	}
	return "", false
}

// Changes is every player whose status changed between the pair's two
// captures, in player id order.
func Changes(pair boards.DesignationPair) []Change {
	ids := map[string]bool{}
	for id := range pair.Newer {
		ids[id] = true
	}
	for id := range pair.Older {
		ids[id] = true
	}
	var out []Change
	for id := range ids {
		from, before := pair.Older[id]
		to, now := pair.Newer[id]
		if c, ok := changeOf(from, to, before, now); ok {
			out = append(out, Change{PlayerID: id, Change: c, From: statusOr(from, before), To: statusOr(to, now)})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PlayerID < out[j].PlayerID })
	return out
}

func statusOr(d boards.Designation, listed bool) string {
	if !listed {
		return ""
	}
	return d.Status()
}

// Designations is the capture pair the producer compares.
// *boards.PGSource implements it.
type Designations interface {
	DesignationPair(ctx context.Context) (boards.DesignationPair, bool, error)
}

// Lineups is each account's starters by followed league.
// *leaguesync.Service implements it.
type Lineups interface {
	Starters(ctx context.Context, accountID uuid.UUID) ([]leaguesync.LeagueStarters, error)
}

// Queue is the part of Store a producer writes through.
type Queue interface {
	PushAccounts(ctx context.Context, kind Kind) ([]uuid.UUID, error)
	Preferences(ctx context.Context, accountID uuid.UUID) (Preferences, error)
	Enqueue(ctx context.Context, rows []Notification) (int, error)
}

// DefaultMaxChangeAge is how old the newer capture may be and still be
// news: a producer that first runs on a pair from yesterday says nothing.
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
	Changes int
	Queued  int
	// NewerAt is the newer capture compared, nil when there was no pair to
	// compare or it was too old.
	NewerAt *time.Time
}

// Produce compares the two newest captures and queues the pushes.
func (p *StarterStatus) Produce(ctx context.Context) (Produced, error) {
	pair, ok, err := p.Designations.DesignationPair(ctx)
	if err != nil {
		return Produced{}, err
	}
	now := p.Now()
	if !ok || now.Sub(pair.NewerAt) > p.maxAge() {
		return Produced{}, nil
	}
	changes := Changes(pair)
	out := Produced{Changes: len(changes), NewerAt: &pair.NewerAt}
	if len(changes) == 0 {
		return out, nil
	}
	accounts, err := p.Queue.PushAccounts(ctx, KindStarterStatus)
	if err != nil {
		return out, err
	}
	for _, accountID := range accounts {
		n, err := p.produceFor(ctx, accountID, changes, pair.NewerAt, now)
		if err != nil {
			return out, err
		}
		out.Queued += n
	}
	return out, nil
}

func (p *StarterStatus) maxAge() time.Duration {
	if p.MaxChangeAge <= 0 {
		return DefaultMaxChangeAge
	}
	return p.MaxChangeAge
}

// produceFor queues one account's pushes: each changed player one of its
// leagues starts, once however many leagues start him.
func (p *StarterStatus) produceFor(ctx context.Context, accountID uuid.UUID, changes []Change, newerAt, now time.Time) (int, error) {
	leagues, err := p.Lineups.Starters(ctx, accountID)
	if err != nil {
		p.Log.Warn("notify: starters", "account_id", accountID, "err", err)
		return 0, nil
	}
	starts := startsByPlayer(leagues)
	prefs, err := p.Queue.Preferences(ctx, accountID)
	if err != nil {
		return 0, err
	}
	var rows []Notification
	for _, c := range changes {
		in := starts[c.PlayerID]
		if len(in) == 0 {
			continue
		}
		rows = append(rows, starterRow(accountID, c, in, newerAt, prefs.SendAfter(now)))
	}
	if len(rows) == 0 {
		return 0, nil
	}
	return p.Queue.Enqueue(ctx, rows)
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
// is queued once however often the producer runs. The deep link opens
// the first league's lineup on him.
func starterRow(accountID uuid.UUID, c Change, in []start, newerAt, sendAfter time.Time) Notification {
	first := in[0]
	title, body := starterWords(c.Change, first.player.Name, first.league.LeagueName, len(in))
	path := "/league/" + first.league.LinkID.String() + "/start?player=" + url.QueryEscape(c.PlayerID)
	return Notification{
		AccountID: accountID, Kind: KindStarterStatus, Title: title, Body: body, SendAfter: sendAfter,
		Data: map[string]string{
			DedupeKey:   fmt.Sprintf("%s:%s:%d", c.PlayerID, c.Change, newerAt.Unix()),
			"player_id": c.PlayerID, "league_id": first.league.LinkID.String(), "change": string(c.Change),
			"path": path,
		},
	}
}
