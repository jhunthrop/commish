package yahoo

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

// The probe (Lane 130) is one operator read of a league's three answers
// that could carry a weekly rank or projection: the week's scoreboard (the
// matchup's projected points), the league's players with their ranks and
// percent owned, and those players' stats for the week. It answers each
// body raw, for the shape reader in leaguesync; nothing here is kept.

// Probe answer names, in the order they are read.
const (
	ProbeScoreboard = "matchup_projected_points"
	ProbeRanks      = "players_ranks_percent_owned"
	ProbeWeekStats  = "players_stats_week"
)

// ProbePlayers is how many of the league's players the probe reads: one
// page of Yahoo's, and the week's stats for the same players.
const ProbePlayers = 25

// ProbeAnswer is one answer: its name, the path read with the league key
// and player keys as placeholders, and the body, or why it was not read.
type ProbeAnswer struct {
	Name string
	Path string
	Body []byte
	Err  error
}

// ProbeRead is the probe's answers and the week Yahoo's scoreboard named.
type ProbeRead struct {
	Week    int
	Answers []ProbeAnswer
}

var playerKeyPattern = regexp.MustCompile(`^[0-9]{1,6}\.p\.[0-9]{1,8}$`)

// Probe reads the three answers. A refused answer is kept as its error and
// the next is read; a refused token ends the probe, so the member reader
// refreshes it and reads again.
func (c *Client) Probe(ctx context.Context, access, leagueKey string) (ProbeRead, error) {
	var out ProbeRead
	read := func(name, path, shown string) ([]byte, error) {
		body, err := c.get(ctx, access, path)
		if errors.Is(err, ErrUnauthorized) || ctx.Err() != nil {
			return nil, errors.Join(err, ctx.Err())
		}
		out.Answers = append(out.Answers, ProbeAnswer{Name: name, Path: shown, Body: body, Err: err})
		return body, nil
	}
	board, err := read(ProbeScoreboard, "league/"+leagueKey+"/scoreboard", "league/{league_key}/scoreboard")
	if err != nil {
		return ProbeRead{}, err
	}
	out.Week = scoreboardWeek(board)
	ranks, err := read(ProbeRanks, fmt.Sprintf("league/%s/players;out=ranks,percent_owned;start=0;count=%d", leagueKey, ProbePlayers),
		fmt.Sprintf("league/{league_key}/players;out=ranks,percent_owned;start=0;count=%d", ProbePlayers))
	if err != nil {
		return ProbeRead{}, err
	}
	keys := probePlayerKeys(ranks)
	if out.Week < 1 || len(keys) == 0 {
		out.Answers = append(out.Answers, ProbeAnswer{Name: ProbeWeekStats, Path: "league/{league_key}/players;player_keys={player_keys}/stats;type=week;week={week}",
			Err: fmt.Errorf("%w: no week (%d) or no player keys (%d) to ask for", ErrMalformed, out.Week, len(keys))})
		return out, nil
	}
	week := fmt.Sprint(out.Week)
	if _, err := read(ProbeWeekStats, "league/"+leagueKey+"/players;player_keys="+strings.Join(keys, ",")+"/stats;type=week;week="+week,
		"league/{league_key}/players;player_keys={player_keys}/stats;type=week;week="+week); err != nil {
		return ProbeRead{}, err
	}
	return out, nil
}

// scoreboardWeek is the week a scoreboard answer names, 0 when it names none.
func scoreboardWeek(body []byte) int {
	var root struct {
		Week int `xml:"league>scoreboard>week"`
	}
	if xml.NewDecoder(bytes.NewReader(body)).Decode(&root) != nil {
		return 0
	}
	return root.Week
}

// probePlayerKeys is the player keys of a players answer, each checked as
// Yahoo's key, at most ProbePlayers.
func probePlayerKeys(body []byte) []string {
	var root struct {
		Keys []string `xml:"league>players>player>player_key"`
	}
	if xml.NewDecoder(bytes.NewReader(body)).Decode(&root) != nil {
		return nil
	}
	var out []string
	for _, k := range root.Keys {
		if playerKeyPattern.MatchString(k) && len(out) < ProbePlayers {
			out = append(out, k)
		}
	}
	return out
}

// Probe is the probe as the member, in the league's season's game (season
// 0 is the current season's), with the reader's refresh and reconnect.
func (m *Member) Probe(ctx context.Context, accountID uuid.UUID, season int, leagueID string) (ProbeRead, error) {
	var out ProbeRead
	err := m.as(ctx, accountID, func(access string) error {
		key, err := m.leagueKey(ctx, access, season, leagueID)
		if err != nil {
			return err
		}
		out, err = m.Client.Probe(ctx, access, key)
		return err
	})
	return out, err
}
