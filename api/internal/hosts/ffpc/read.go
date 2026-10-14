package ffpc

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

// League is one league as its pages read, every page through its parser.
// Missing names each page that was not read or did not parse, so a view
// can say what it lacks instead of guessing.
type League struct {
	Banner    Banner     `json:"banner"`
	Standings []Standing `json:"standings"`
	Owners    []Owner    `json:"owners"`
	Rosters   []Roster   `json:"rosters"`
	// OtherRosterColumns are rosters page headings we do not know: their
	// players are rostered, unmarked, and the heading is worth naming.
	OtherRosterColumns []string `json:"other_roster_columns,omitempty"`
	Lineup             *Lineup  `json:"lineup"`
	Schedule           []Week   `json:"schedule"`
	Moves              []Move   `json:"moves"`
	Rules              *Rules   `json:"rules"`
	// Scoreboard is the live scoring page, read only in an all-play
	// week, when it is where the member's score comes from.
	Scoreboard *Scoreboard `json:"scoreboard,omitempty"`
	Missing    []string    `json:"missing"`
}

// LeaguePages are the pages one league read takes, in the order read.
// The rules pages are read at most once a day (RulesPages).
var LeaguePages = []PageName{PageLeagueHome, PageStandings, PageRosters, PageLineup, PageSchedule, PageOwners}

// RulesPages are the pages a league's settings come from.
var RulesPages = []PageName{PageRules}

// Parse reads whichever league pages are given. The league home page is
// required (its banner names the league and the member's team); every
// other page is optional and named in Missing when absent or unreadable.
// official is the official rules page, nil when not read.
func Parse(pages map[PageName][]byte, official []byte) (League, error) {
	var l League
	home, ok := pages[PageLeagueHome]
	if !ok {
		return League{}, fmt.Errorf("%w: no league home page", ErrNotThisPage)
	}
	b, err := ParseBanner(home)
	if err != nil {
		return League{}, err
	}
	l.Banner = b
	miss := func(name PageName, err error) {
		l.Missing = append(l.Missing, fmt.Sprintf("%s: %v", name, err))
	}
	if moves, err := ParseMoves(home); err == nil {
		l.Moves = moves
	} else {
		miss(PageLeagueHome, err)
	}
	read := func(name PageName, parse func([]byte) error) {
		body, ok := pages[name]
		if !ok {
			return
		}
		if err := parse(body); err != nil {
			miss(name, err)
		}
	}
	read(PageStandings, func(p []byte) (err error) { l.Standings, err = ParseStandings(p); return })
	read(PageOwners, func(p []byte) (err error) { l.Owners, err = ParseOwners(p); return })
	read(PageRosters, func(p []byte) error {
		page, err := ParseRostersPage(p)
		l.Rosters, l.OtherRosterColumns = page.Teams, page.OtherColumns
		return err
	})
	read(PageSchedule, func(p []byte) (err error) { l.Schedule, err = ParseSchedule(p); return })
	read(PageLineup, func(p []byte) error {
		lineup, err := ParseLineup(p)
		if err == nil {
			l.Lineup = &lineup
		}
		return err
	})
	read(PageScoreboard, func(p []byte) error {
		board, err := ParseScoreboard(p)
		if err == nil {
			l.Scoreboard = &board
		}
		return err
	})
	read(PageRules, func(p []byte) error {
		rules, err := ParseRules(p)
		if err == nil {
			l.Rules = &rules
		}
		return err
	})
	if l.Rules != nil && len(l.Rules.Scoring) == 0 && official != nil {
		scoring, unread, err := ParseScoring(official)
		if err != nil {
			miss("official_rules", err)
		} else {
			l.Rules.Scoring, l.Rules.Unread = scoring, unread
		}
	}
	return l, nil
}

// ReadLeague reads a league's pages as the member and parses them. With
// rules it also reads the rules page and the official rules it points at.
func (m *Member) ReadLeague(ctx context.Context, accountID uuid.UUID, ltuid string, rules bool) (League, error) {
	names := append([]PageName(nil), LeaguePages...)
	if rules {
		names = append(names, RulesPages...)
	}
	pages, err := m.Pages(ctx, accountID, ltuid, names...)
	if err != nil {
		return League{}, err
	}
	if allPlayNow(pages) {
		// One more page, only in an all-play week: the schedule lists no
		// game, so the member's score is read from the scoring page.
		// Its failure leaves the score unread, never the league.
		if more, err := m.Pages(ctx, accountID, ltuid, PageScoreboard); err == nil {
			pages[PageScoreboard] = more[PageScoreboard]
		} else {
			m.Log.Warn("ffpc: scoreboard", "err", err)
		}
	}
	var official []byte
	if rules {
		if r, err := ParseRules(pages[PageRules]); err == nil && len(r.Scoring) == 0 && r.OfficialRules != "" {
			if official, err = m.Client.OfficialRules(ctx, r.OfficialRules); err != nil {
				m.Log.Warn("ffpc: official rules", "err", err)
				official = nil
			}
		}
	}
	return Parse(pages, official)
}

// allPlayNow says the schedule sets the lineup page's week as all-play.
func allPlayNow(pages map[PageName][]byte) bool {
	lineup, err := ParseLineup(pages[PageLineup])
	if err != nil || lineup.Week == 0 {
		return false
	}
	weeks, err := ParseSchedule(pages[PageSchedule])
	if err != nil {
		return false
	}
	for _, w := range weeks {
		if w.Number == lineup.Week {
			return w.AllPlay
		}
	}
	return false
}

// ReadDraft reads the member's draft board as them.
func (m *Member) ReadDraft(ctx context.Context, accountID uuid.UUID, ltuid string) (Draft, error) {
	pages, err := m.Pages(ctx, accountID, ltuid, PageDraftBoard)
	if err != nil {
		return Draft{}, err
	}
	d, err := ParseDraftBoard(pages[PageDraftBoard])
	if errors.Is(err, ErrNotThisPage) {
		return Draft{}, fmt.Errorf("%w: draft board", ErrNotThisPage)
	}
	return d, err
}
