// Package leaguesync attaches a drafter's own league on another host and
// keeps it fresh (spec §2.9, lane 1 of the in-season tools): rosters,
// standings, the week's matchup, recent moves, the league's scoring as a
// saved league's custom rules, and the unrostered pool on our board.
//
// Two hosts sit behind one Host interface and one polling discipline:
// Sleeper (public by league id) and MyFantasyLeague (public leagues by
// season and id). A league is read upstream at most once a minute per
// process whatever the viewer count, the last good read is kept per host
// league and answered with how stale it is when the host fails, and
// nothing a caller sends reaches the host but an id this package parsed.
package leaguesync

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// Host keys, as the contract (openapi.yaml LeagueHost) spells them.
const (
	HostSleeper = "sleeper"
	HostMFL     = "mfl"
)

// Ref names one league on one host. Season is part of the name on
// MyFantasyLeague, where a league keeps its id from season to season, and
// 0 on Sleeper, where a league has a new id each season.
//
// As is the account a league attached as a member is read for (every
// FFPC and Yahoo league, a private ESPN league), uuid.Nil for a read anyone may
// share: a host credential reads only for the account that stored it, so
// such a league is read, kept and answered apart for each such account.
type Ref struct {
	Host     string    `json:"host"`
	LeagueID string    `json:"league_id"`
	Season   int       `json:"season"`
	As       uuid.UUID `json:"-"`
}

// Key is the poller's and the store's key for the league: one read for
// everyone, or one for the account it is read as.
func (r Ref) Key() string {
	base := fmt.Sprintf("%s/%d/%s", r.Host, r.Season, r.LeagueID)
	if r.As == uuid.Nil {
		return base
	}
	return base + asSeparator + r.As.String()
}

// asSeparator divides a member read's key from the account it is read as.
const asSeparator = "@"

// Shared is the ref read as anyone: the league itself, not an account's
// read of it.
func (r Ref) Shared() Ref {
	r.As = uuid.Nil
	return r
}

// Snapshot is a league as one read found it, the same shape for every
// host. It is persisted whole per host league (app.league_snapshots).
type Snapshot struct {
	Ref    Ref    `json:"ref"`
	Name   string `json:"name"`
	Status string `json:"status"`
	// Season is the league's season, 0 when the host does not say.
	Season int `json:"season"`
	// Week is the host's current week for this league's season, 0 when
	// the season has no current week (before it starts, or a past season).
	Week int `json:"week"`
	// AllPlay says the host's schedule sets Week as all-play: every team
	// is scored against every other and no side has an opponent.
	AllPlay  bool      `json:"all_play,omitempty"`
	Teams    []Team    `json:"teams"`
	Matchups []Side    `json:"matchups"`
	Moves    []Move    `json:"moves"`
	Scoring  Scoring   `json:"scoring"`
	Shape    Shape     `json:"shape"`
	ReadAt   time.Time `json:"read_at"`
	// Players names the players of a pushed host's league, from its own
	// pages: a pushed host has no directory of ours to read.
	Players map[string]HostPlayer `json:"players,omitempty"`
	// Pool is the host's own status for the unrostered players it names
	// apart (Yahoo's waiver wire): a player listed here is on waivers, one
	// neither listed nor rostered is a free agent. Empty for a host that
	// does not say.
	Pool []PoolPlayer `json:"pool,omitempty"`
	// PoolUnknown says the host's pool status could not be read this
	// time (Yahoo's waiver wire did not answer): nobody is known to be on
	// waivers or free, rather than everyone free.
	PoolUnknown bool `json:"pool_unknown,omitempty"`
	// Calendar is the host's word on the league's draft, playoffs and
	// waivers, the facts its phase is read from (phase.go).
	Calendar Calendar `json:"calendar"`
	// Terms is the host's word on the league's waivers and playoffs, for
	// the league page's settings (terms.go).
	Terms Terms `json:"terms"`
	// Schedule is the season's games, every week's pairings and each
	// played week's scores (Lane 298, schedule.go): ESPN's and FFPC's from
	// the read itself, Sleeper's, Yahoo's and MyFantasyLeague's from the
	// weeks the schedule keeper has kept (schedulekeep.go). Empty where
	// none is read yet; Matchups stays the live week's sides.
	Schedule []ScheduledGame `json:"schedule,omitempty"`
}

// Pool statuses, as the waiver tool reads them.
const (
	PoolWaivers = "waivers"
)

// PoolPlayer is one unrostered player's status on the host, and the day
// a waiver claim on him clears (YYYY-MM-DD), empty when the host does not
// say.
type PoolPlayer struct {
	PlayerID string `json:"player_id"`
	Status   string `json:"status"`
	Until    string `json:"until,omitempty"`
}

// Team is one roster in the league.
type Team struct {
	RosterID int    `json:"roster_id"`
	Name     string `json:"name"`
	Owner    string `json:"owner"`
	// OwnerIDs are the host's user ids that run the team, for finding a
	// drafter's seat by username (Sleeper only).
	OwnerIDs  []string `json:"owner_ids"`
	Players   []string `json:"players"`
	Starters  []string `json:"starters"`
	Reserve   []string `json:"reserve"`
	Taxi      []string `json:"taxi"`
	Wins      int      `json:"wins"`
	Losses    int      `json:"losses"`
	Ties      int      `json:"ties"`
	PointsFor float64  `json:"points_for"`
	// PointsAgainst is the season's points against, nil where the host
	// does not say.
	PointsAgainst *float64 `json:"points_against,omitempty"`
	// Streak is the run of wins or losses, "W3" or "L2", empty where the
	// host does not say.
	Streak string `json:"streak,omitempty"`
	// WaiverOrder is the team's place in the waiver order, 0 where the
	// host does not say.
	WaiverOrder int `json:"waiver_order,omitempty"`
	// BudgetLeft is the waiver budget the team has left, nil without a
	// budget or where the host does not say.
	BudgetLeft *int `json:"budget_left,omitempty"`
	// Avatar is the host's image for the team or its owner, empty where
	// the host gives none we show.
	Avatar string `json:"avatar,omitempty"`
	// Division is the team's division as the platform numbers it, 0 for
	// none or unread (Lane 298 fix round 1).
	Division int `json:"division,omitempty"`
}

// Side is one team's side of the week's matchup.
type Side struct {
	RosterID int `json:"roster_id"`
	// Game pairs two sides; sides with the same Game play each other. 0
	// is a team with no opponent this week.
	Game   int     `json:"game"`
	Points float64 `json:"points"`
	// PointsUnread says the host's score for the side could not be read,
	// so Points says nothing (an FFPC all-play week whose scoring page
	// did not answer).
	PointsUnread bool               `json:"points_unread,omitempty"`
	Starters     []string           `json:"starters"`
	PlayerPoints map[string]float64 `json:"player_points"`
}

// Move kinds, the same for every host.
const (
	MoveAdd    = "add"
	MoveWaiver = "waiver"
	MoveTrade  = "trade"
)

// Move is one completed roster move.
type Move struct {
	Kind      string         `json:"kind"`
	RosterIDs []int          `json:"roster_ids"`
	Adds      map[string]int `json:"adds"`
	Drops     map[string]int `json:"drops"`
	At        time.Time      `json:"at"`
	// Bid is a claim's bid from the league's waiver budget, nil for a
	// move with none.
	Bid *int `json:"bid,omitempty"`
}

// Scoring is the league's points per stat as ScoringRules (rules.go),
// every host rule that does not land there in the host's own words, and
// every rule key the host does not state, at the standard figure.
type Scoring struct {
	Rules     map[string]float64 `json:"rules"`
	Dropped   []string           `json:"dropped"`
	Defaulted []string           `json:"defaulted"`
	// DroppedRules is Dropped by rule, group and figure, for the scoring
	// import's list; nil for a host whose words carry their own figures
	// (MyFantasyLeague) and in a snapshot kept before it existed.
	DroppedRules []scoring.DroppedRule `json:"dropped_rules,omitempty"`
}

// Shape is the league's starting lineup and bench, by our slot names.
type Shape struct {
	Teams     int `json:"teams"`
	QB        int `json:"qb"`
	RB        int `json:"rb"`
	WR        int `json:"wr"`
	TE        int `json:"te"`
	K         int `json:"k"`
	DEF       int `json:"def"`
	Flex      int `json:"flex"`
	SuperFlex int `json:"super_flex"`
	Bench     int `json:"bench"`
	// IR is the league's injured reserve slots on a team, from its
	// platform's settings (ESPN, Sleeper, Yahoo; 0 where a platform's are
	// not read), and IROut whether a player ruled out may take one beside
	// a player on injured reserve (Lane 118, B79): ESPN's slot takes him,
	// Sleeper's where the league allows it, Yahoo's never. Neither is on
	// the wire; a snapshot saved before them reads no slot.
	IR    int  `json:"ir,omitempty"`
	IROut bool `json:"ir_out,omitempty"`
	// Unfollowed names the slots a mock room cannot draft (a defensive
	// player, a receiver-only flex), empty when every slot is followed.
	Unfollowed []string `json:"unfollowed"`
}

// TeamByRoster is the team with the roster id, and whether there is one.
func (s Snapshot) TeamByRoster(id int) (Team, bool) {
	for _, t := range s.Teams {
		if t.RosterID == id {
			return t, true
		}
	}
	return Team{}, false
}

// Errors a caller tells apart.
var (
	// ErrNotALink is pasted text that names no league on a host we follow.
	ErrNotALink = errors.New("leaguesync: not a league link")
	// ErrNotFound is a league the host does not know.
	ErrNotFound = errors.New("leaguesync: no such league")
	// ErrPrivate is a league that answers only to its own members.
	ErrPrivate = errors.New("leaguesync: private league")
	// ErrUnavailable is the host failing, with no earlier read to answer.
	ErrUnavailable = errors.New("leaguesync: host unavailable")
	// ErrNoSeat is a username or roster the league does not hold.
	ErrNoSeat = errors.New("leaguesync: not in this league")
	// ErrSeatByName is a host that cannot find a seat by username.
	ErrSeatByName = errors.New("leaguesync: host has no usernames")
)

// API is the lineup as the contract names it (LeagueShape).
func (s Shape) API() apitypes.LeagueShape {
	return apitypes.LeagueShape{
		Qb: s.QB, Rb: s.RB, Wr: s.WR, Te: s.TE, Flex: s.Flex, SuperFlex: s.SuperFlex, K: s.K, Def: s.DEF, Bench: s.Bench,
	}
}
