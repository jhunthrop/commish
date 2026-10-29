package yahoo

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Bounds on what a read takes in.
const (
	MaxTeams     = 32
	maxLeagues   = 50
	maxPlayers   = 60
	maxMoves     = 100
	maxStats     = 300
	maxSlots     = 40
	maxSlotCount = 20
	maxPoints    = 100
	maxScore     = 10000
)

// MyLeague is one of the member's leagues, as their league list shows it.
type MyLeague struct {
	LeagueID    string
	GameKey     string
	Season      int
	Name        string
	Teams       int
	ScoringType string
	TeamName    string
}

// League is one whole read of a league.
type League struct {
	LeagueID    string
	Name        string
	Season      int
	CurrentWeek int
	ScoringType string
	DraftStatus string
	Finished    bool
	// DraftAt is the league's draft time (settings draft_time), nil when
	// Yahoo does not say.
	DraftAt *time.Time
	// PlayoffStartWeek is the league's first playoff week (settings
	// playoff_start_week), 0 for a league with no playoffs.
	PlayoffStartWeek int
	// PlayoffTeams is settings num_playoff_teams, 0 for a league with no
	// playoffs or one that does not say (Lane 298).
	PlayoffTeams int
	Teams        []Team
	Settings     Settings
	Scoreboard   Scoreboard
	Moves        []Move
	// Waivers is every unrostered player on waivers; every other
	// unrostered player is a free agent.
	Waivers []Waiver
	// WaiversErr is why the waiver wire could not be read, nil when it
	// was: waiver status is then unknown for this read.
	WaiversErr error
}

// Team is one team, with its record and its roster this week.
type Team struct {
	ID        int
	Name      string
	Owner     string
	Mine      bool
	Wins      int
	Losses    int
	Ties      int
	PointsFor float64
	Players   []Player
}

// Player is one player as Yahoo lists him, and the slot he fills this
// week on a roster.
type Player struct {
	ID       string
	Name     string
	Position string
	Team     string
	// Slot is the roster slot he fills: QB, W/R/T, BN, IR.
	Slot string
	// Injured is Yahoo's IR mark beside his name.
	Injured bool
}

// Settings is a league's lineup and scoring.
type Settings struct {
	Slots     []Slot
	Stats     []Stat
	Modifiers []Modifier
}

// Slot is one roster position and how many the lineup has.
type Slot struct {
	Position string
	Count    int
	Starting bool
}

// Stat is one stat category the league names.
type Stat struct {
	ID           int
	Name         string
	PositionType string
	Enabled      bool
}

// Modifier is the points a stat scores, and any bonus at a target.
type Modifier struct {
	StatID  int
	Points  float64
	Bonuses []Bonus
}

// Bonus is a stat's bonus points at a target.
type Bonus struct {
	Target float64
	Points float64
}

// Scoreboard is the week's games.
type Scoreboard struct {
	Week  int
	Games []Game
}

// Game is one matchup: two teams and their points, and whether Yahoo
// has scored it final (its status postevent, Lane 298).
type Game struct {
	TeamIDs [2]int
	Points  [2]float64
	Final   bool
}

// Move is one completed transaction.
type Move struct {
	Kind  string
	At    time.Time
	Adds  map[string]int
	Drops map[string]int
	// Players names the players the move names.
	Players []Player
}

// Move kinds, as Yahoo's transaction types read.
const (
	MoveAdd    = "add"
	MoveWaiver = "waiver"
	MoveTrade  = "trade"
)

type xmlPlayer struct {
	PlayerID string `xml:"player_id"`
	Name     struct {
		Full string `xml:"full"`
	} `xml:"name"`
	Status          string `xml:"status"`
	Team            string `xml:"editorial_team_abbr"`
	DisplayPosition string `xml:"display_position"`
	PrimaryPosition string `xml:"primary_position"`
	Selected        struct {
		Position string `xml:"position"`
	} `xml:"selected_position"`
	Data struct {
		Type       string `xml:"type"`
		SourceType string `xml:"source_type"`
		SourceTeam string `xml:"source_team_key"`
		DestTeam   string `xml:"destination_team_key"`
	} `xml:"transaction_data"`
}

type xmlTeam struct {
	TeamKey  string `xml:"team_key"`
	TeamID   string `xml:"team_id"`
	Name     string `xml:"name"`
	Owned    string `xml:"is_owned_by_current_login"`
	Managers []struct {
		Nickname       string `xml:"nickname"`
		IsCurrentLogin string `xml:"is_current_login"`
	} `xml:"managers>manager"`
	Standings struct {
		Totals struct {
			Wins   int `xml:"wins"`
			Losses int `xml:"losses"`
			Ties   int `xml:"ties"`
		} `xml:"outcome_totals"`
		PointsFor float64 `xml:"points_for"`
	} `xml:"team_standings"`
	Points struct {
		Total float64 `xml:"total"`
	} `xml:"team_points"`
	Players []xmlPlayer `xml:"roster>players>player"`
}

type xmlLeague struct {
	LeagueKey   string    `xml:"league_key"`
	LeagueID    string    `xml:"league_id"`
	Name        string    `xml:"name"`
	NumTeams    int       `xml:"num_teams"`
	ScoringType string    `xml:"scoring_type"`
	DraftStatus string    `xml:"draft_status"`
	CurrentWeek int       `xml:"current_week"`
	IsFinished  string    `xml:"is_finished"`
	Season      int       `xml:"season"`
	Teams       []xmlTeam `xml:"teams>team"`
	Standings   []xmlTeam `xml:"standings>teams>team"`
	Settings    struct {
		DraftTime        int64  `xml:"draft_time"`
		UsesPlayoff      string `xml:"uses_playoff"`
		PlayoffStartWeek int    `xml:"playoff_start_week"`
		PlayoffTeams     int    `xml:"num_playoff_teams"`
		Slots            []struct {
			Position string `xml:"position"`
			Count    int    `xml:"count"`
			Starting string `xml:"is_starting_position"`
		} `xml:"roster_positions>roster_position"`
		Stats []struct {
			ID           int    `xml:"stat_id"`
			Enabled      string `xml:"enabled"`
			Name         string `xml:"name"`
			PositionType string `xml:"position_type"`
		} `xml:"stat_categories>stats>stat"`
		Modifiers []struct {
			ID      int     `xml:"stat_id"`
			Value   float64 `xml:"value"`
			Bonuses []struct {
				Target float64 `xml:"target"`
				Points float64 `xml:"points"`
			} `xml:"bonuses>bonus"`
		} `xml:"stat_modifiers>stats>stat"`
	} `xml:"settings"`
	Scoreboard struct {
		Week     int `xml:"week"`
		Matchups []struct {
			Week   int       `xml:"week"`
			Status string    `xml:"status"`
			Teams  []xmlTeam `xml:"teams>team"`
		} `xml:"matchups>matchup"`
	} `xml:"scoreboard"`
	Transactions []struct {
		Type      string      `xml:"type"`
		Status    string      `xml:"status"`
		Timestamp int64       `xml:"timestamp"`
		Players   []xmlPlayer `xml:"players>player"`
	} `xml:"transactions>transaction"`
}

type xmlGame struct {
	GameKey string      `xml:"game_key"`
	Code    string      `xml:"code"`
	Season  int         `xml:"season"`
	Leagues []xmlLeague `xml:"leagues>league"`
	Teams   []xmlTeam   `xml:"teams>team"`
}

type xmlRoot struct {
	XMLName xml.Name  `xml:"fantasy_content"`
	League  xmlLeague `xml:"league"`
	Games   []xmlGame `xml:"games>game"`
	Users   []struct {
		Games []xmlGame `xml:"games>game"`
	} `xml:"users>user"`
}

func decode(body []byte) (xmlRoot, error) {
	var root xmlRoot
	d := xml.NewDecoder(bytes.NewReader(body))
	if err := d.Decode(&root); err != nil {
		return xmlRoot{}, fmt.Errorf("%w: %w", ErrMalformed, err)
	}
	return root, nil
}

// ParseGameKey is the football game's key for the season from a games
// answer.
func ParseGameKey(body []byte, season int) (string, error) {
	root, err := decode(body)
	if err != nil {
		return "", err
	}
	for _, g := range root.Games {
		if g.Season == season && gameKeyPattern.MatchString(g.GameKey) {
			return g.GameKey, nil
		}
	}
	return "", fmt.Errorf("%w: no football game for %d", ErrNoSuchLeague, season)
}

// ParseMyLeagues reads the member's leagues and teams answers into one
// line a league, the member's team name on it.
func ParseMyLeagues(leaguesBody, teamsBody []byte) ([]MyLeague, error) {
	leagues, err := decode(leaguesBody)
	if err != nil {
		return nil, err
	}
	teams, err := decode(teamsBody)
	if err != nil {
		return nil, err
	}
	teamName := map[string]string{}
	for _, u := range teams.Users {
		for _, g := range u.Games {
			for _, t := range g.Teams {
				if league, _, ok := splitTeamKey(t.TeamKey); ok {
					teamName[league] = clean(t.Name)
				}
			}
		}
	}
	out := []MyLeague{}
	for _, u := range leagues.Users {
		for _, g := range u.Games {
			for _, l := range g.Leagues {
				if len(out) >= maxLeagues {
					break
				}
				if !leagueIDPattern.MatchString(l.LeagueID) || !gameKeyPattern.MatchString(g.GameKey) {
					continue
				}
				season := l.Season
				if season == 0 {
					season = g.Season
				}
				out = append(out, MyLeague{
					LeagueID: l.LeagueID, GameKey: g.GameKey, Season: season, Name: clean(l.Name),
					Teams: bounded(l.NumTeams, 0, MaxTeams), ScoringType: l.ScoringType,
					TeamName: teamName[g.GameKey+".l."+l.LeagueID],
				})
			}
		}
	}
	return out, nil
}

// splitTeamKey reads "461.l.12345.t.3" into its league key and team id.
func splitTeamKey(key string) (string, int, bool) {
	league, team, ok := strings.Cut(key, ".t.")
	if !ok {
		return "", 0, false
	}
	id, err := strconv.Atoi(team)
	if err != nil || id < 1 || id > MaxTeams {
		return "", 0, false
	}
	return league, id, true
}

func teamID(t xmlTeam) (int, bool) {
	if id, err := strconv.Atoi(strings.TrimSpace(t.TeamID)); err == nil && id >= 1 && id <= MaxTeams {
		return id, true
	}
	_, id, ok := splitTeamKey(t.TeamKey)
	return id, ok
}

// ParseLeague reads a league's head (settings, standings, scoreboard and
// transactions) and its rosters answer into one league.
func ParseLeague(headBody, rostersBody []byte) (League, error) {
	head, err := decode(headBody)
	if err != nil {
		return League{}, err
	}
	rosters, err := decode(rostersBody)
	if err != nil {
		return League{}, err
	}
	h := head.League
	if !leagueIDPattern.MatchString(h.LeagueID) {
		return League{}, fmt.Errorf("%w: no league id", ErrMalformed)
	}
	l := League{
		LeagueID: h.LeagueID, Name: clean(h.Name), Season: h.Season, CurrentWeek: bounded(h.CurrentWeek, 0, maxWeek),
		ScoringType: h.ScoringType, DraftStatus: h.DraftStatus, Finished: h.IsFinished == "1",
		Settings: settings(h), Scoreboard: scoreboard(h), Moves: moves(h), DraftAt: draftTime(h.Settings.DraftTime),
	}
	if h.Settings.UsesPlayoff == "1" {
		l.PlayoffStartWeek = bounded(h.Settings.PlayoffStartWeek, 0, maxWeek)
		l.PlayoffTeams = bounded(h.Settings.PlayoffTeams, 0, MaxTeams)
	}
	teams, err := leagueTeams(h.Standings, rosters.League.Teams)
	if err != nil {
		return League{}, err
	}
	if l.DraftStatus == draftDone && noRosters(teams) {
		// A league past its draft always has players on its rosters: an
		// answer with none is one we do not read, never an empty league
		// whose every player reads as free.
		return League{}, fmt.Errorf("%w: a drafted league read with no player on any roster", ErrMalformed)
	}
	l.Teams = teams
	return l, nil
}

// draftDone is Yahoo's draft status for a league past its draft.
const draftDone = "postdraft"

func noRosters(teams []Team) bool {
	for _, t := range teams {
		if len(t.Players) > 0 {
			return false
		}
	}
	return true
}

// Ownership kinds a waiver read names.
const ownedByWaivers = "waivers"

// Waiver is a player on waivers, and the day his claim clears, empty when
// Yahoo does not say.
type Waiver struct {
	Player Player
	Until  string
}

type xmlWaiverPlayer struct {
	xmlPlayer
	Ownership struct {
		Type       string `xml:"ownership_type"`
		WaiverDate string `xml:"waiver_date"`
	} `xml:"ownership"`
}

var waiverDate = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}$`)

// ParseWaivers reads one page of a league's players on waivers
// (players;status=W;out=ownership), and how many players the page held.
func ParseWaivers(body []byte) ([]Waiver, int, error) {
	var root struct {
		XMLName xml.Name          `xml:"fantasy_content"`
		Players []xmlWaiverPlayer `xml:"league>players>player"`
	}
	if err := xml.NewDecoder(bytes.NewReader(body)).Decode(&root); err != nil {
		return nil, 0, fmt.Errorf("%w: %w", ErrMalformed, err)
	}
	out := []Waiver{}
	for _, p := range root.Players {
		pl, ok := player(p.xmlPlayer)
		if !ok || (p.Ownership.Type != "" && p.Ownership.Type != ownedByWaivers) {
			continue
		}
		w := Waiver{Player: pl}
		if waiverDate.MatchString(p.Ownership.WaiverDate) {
			w.Until = p.Ownership.WaiverDate
		}
		out = append(out, w)
	}
	return out, len(root.Players), nil
}

// leagueTeams is every team: its record from the standings, its name,
// manager and roster from the rosters answer.
func leagueTeams(standings, rosters []xmlTeam) ([]Team, error) {
	if len(rosters) == 0 || len(rosters) > MaxTeams {
		return nil, fmt.Errorf("%w: %d teams", ErrMalformed, len(rosters))
	}
	record := map[int]xmlTeam{}
	for _, t := range standings {
		if id, ok := teamID(t); ok {
			record[id] = t
		}
	}
	out := make([]Team, 0, len(rosters))
	for _, t := range rosters {
		id, ok := teamID(t)
		if !ok {
			return nil, fmt.Errorf("%w: a team with no id", ErrMalformed)
		}
		team := Team{ID: id, Name: clean(t.Name), Mine: t.Owned == "1"}
		for _, m := range t.Managers {
			if team.Owner == "" {
				team.Owner = clean(m.Nickname)
			}
			team.Mine = team.Mine || m.IsCurrentLogin == "1"
		}
		if s, ok := record[id]; ok {
			team.Wins, team.Losses, team.Ties = s.Standings.Totals.Wins, s.Standings.Totals.Losses, s.Standings.Totals.Ties
			team.PointsFor = boundedScore(s.Standings.PointsFor)
		}
		for i, p := range t.Players {
			if i >= maxPlayers {
				break
			}
			if pl, ok := player(p); ok {
				team.Players = append(team.Players, pl)
			}
		}
		out = append(out, team)
	}
	return out, nil
}

var playerIDPattern = leagueIDPattern

func player(p xmlPlayer) (Player, bool) {
	if !playerIDPattern.MatchString(p.PlayerID) {
		return Player{}, false
	}
	pos := strings.TrimSpace(p.PrimaryPosition)
	if pos == "" {
		pos, _, _ = strings.Cut(p.DisplayPosition, ",")
	}
	return Player{
		ID: p.PlayerID, Name: clean(p.Name.Full), Position: strings.ToUpper(strings.TrimSpace(pos)),
		Team: strings.ToUpper(clean(p.Team)), Slot: strings.ToUpper(strings.TrimSpace(p.Selected.Position)),
		Injured: strings.EqualFold(strings.TrimSpace(p.Status), "IR"),
	}, true
}

func settings(h xmlLeague) Settings {
	var s Settings
	for i, slot := range h.Settings.Slots {
		if i >= maxSlots {
			break
		}
		s.Slots = append(s.Slots, Slot{
			Position: strings.ToUpper(clean(slot.Position)), Count: bounded(slot.Count, 0, maxSlotCount), Starting: slot.Starting == "1",
		})
	}
	for i, st := range h.Settings.Stats {
		if i >= maxStats {
			break
		}
		s.Stats = append(s.Stats, Stat{ID: st.ID, Name: clean(st.Name), PositionType: st.PositionType, Enabled: st.Enabled != "0"})
	}
	for i, m := range h.Settings.Modifiers {
		if i >= maxStats || !boundedFigure(m.Value) {
			continue
		}
		mod := Modifier{StatID: m.ID, Points: m.Value}
		for _, b := range m.Bonuses {
			if boundedFigure(b.Points) && b.Target >= 0 && b.Target < 10000 {
				mod.Bonuses = append(mod.Bonuses, Bonus{Target: b.Target, Points: b.Points})
			}
		}
		s.Modifiers = append(s.Modifiers, mod)
	}
	return s
}

// statusFinal is a matchup Yahoo has scored final.
const statusFinal = "postevent"

// ParseScoreboard reads one week's scoreboard
// (league/{key}/scoreboard;week=N): its week and its games.
func ParseScoreboard(body []byte) (Scoreboard, error) {
	root, err := decode(body)
	if err != nil {
		return Scoreboard{}, err
	}
	sb := scoreboard(root.League)
	if sb.Week == 0 {
		return Scoreboard{}, fmt.Errorf("%w: scoreboard names no week", ErrMalformed)
	}
	return sb, nil
}

func scoreboard(h xmlLeague) Scoreboard {
	sb := Scoreboard{Week: bounded(h.Scoreboard.Week, 0, 25)}
	for _, m := range h.Scoreboard.Matchups {
		if len(m.Teams) != 2 {
			continue
		}
		g := Game{Final: m.Status == statusFinal}
		ok := true
		for i, t := range m.Teams {
			id, valid := teamID(t)
			ok = ok && valid
			g.TeamIDs[i], g.Points[i] = id, boundedScore(t.Points.Total)
		}
		if ok && len(sb.Games) < MaxTeams {
			sb.Games = append(sb.Games, g)
		}
	}
	return sb
}

// moves is the completed transactions, newest first as Yahoo lists them.
// A commissioner's move is left out: it is not a manager's.
func moves(h xmlLeague) []Move {
	out := []Move{}
	for _, tx := range h.Transactions {
		if len(out) >= maxMoves {
			break
		}
		if tx.Status != "successful" {
			continue
		}
		var kind string
		switch tx.Type {
		case "add", "drop", "add/drop":
			kind = MoveAdd
		case "trade":
			kind = MoveTrade
		default:
			continue
		}
		m := Move{Kind: kind, At: time.Unix(tx.Timestamp, 0).UTC(), Adds: map[string]int{}, Drops: map[string]int{}}
		for _, p := range tx.Players {
			pl, ok := player(p)
			if !ok {
				continue
			}
			m.Players = append(m.Players, pl)
			if _, to, ok := splitTeamKey(p.Data.DestTeam); ok && p.Data.Type != "drop" {
				m.Adds[pl.ID] = to
				if p.Data.SourceType == "waivers" && kind == MoveAdd {
					m.Kind = MoveWaiver
				}
			}
			if _, from, ok := splitTeamKey(p.Data.SourceTeam); ok && p.Data.Type != "add" {
				m.Drops[pl.ID] = from
			}
		}
		if len(m.Adds)+len(m.Drops) > 0 {
			out = append(out, m)
		}
	}
	return out
}

// clean is Yahoo's text made safe to repeat: trimmed, no control
// characters, at most 80 runes.
func clean(s string) string {
	s = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r < ' ' || r == 0x7f {
			return -1
		}
		return r
	}, strings.ToValidUTF8(s, "")))
	if r := []rune(s); len(r) > 80 {
		s = string(r[:80])
	}
	return s
}

func bounded(n, lo, hi int) int { return min(max(n, lo), hi) }

func boundedFigure(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && math.Abs(v) <= maxPoints
}

func boundedScore(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > maxScore {
		return 0
	}
	return math.Round(v*100) / 100
}

// maxWeek bounds a week Yahoo names.
const maxWeek = 25

// Bounds on a draft time Yahoo states: 2000 to 2100, in Unix seconds.
const (
	minDraftTime = 946684800
	maxDraftTime = 4102444800
)

// draftTime is the league's draft time from Yahoo's Unix seconds, nil
// when Yahoo states none or one out of bounds.
func draftTime(unix int64) *time.Time {
	if unix < minDraftTime || unix > maxDraftTime {
		return nil
	}
	t := time.Unix(unix, 0).UTC()
	return &t
}
