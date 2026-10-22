package leaguesync

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/jhunthrop/commish/api/internal/hosts/yahoo"
)

// The Yahoo probe (Lane 130): one operator read, as the member who attached
// a Yahoo league, of the answers that could carry a weekly rank or
// projection, kept as their shapes only: every field's name, one example
// row with member data blanked, and the distinct values of the fields that
// say what a figure covers (its rank type, season, week, coverage). The
// answers themselves are never kept or printed.

// YahooProbeName names the probe's record, so its log line is found.
const YahooProbeName = "yahoo-week"

// Bounds on a shape.
const (
	probeValuesPerField = 24
	probeMaxDepth       = 32
)

// YahooProber reads the probe's answers as a member. *yahoo.Member
// implements it.
type YahooProber interface {
	Probe(ctx context.Context, accountID uuid.UUID, season int, leagueID string) (yahoo.ProbeRead, error)
}

// YahooProbeLeagues lists the Yahoo leagues a probe may read. *Store
// implements it.
type YahooProbeLeagues interface {
	YahooMemberLeagues(ctx context.Context, season int) ([]Ref, error)
}

// YahooProbe is the probe's record: the week Yahoo named and each answer's
// shape. It names no league, team or member.
type YahooProbe struct {
	Probe   string       `json:"probe"`
	ReadAt  time.Time    `json:"read_at"`
	Season  int          `json:"season"`
	Week    int          `json:"week"`
	Answers []ProbeShape `json:"answers"`
}

// ProbeShape is one answer's shape.
type ProbeShape struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Error string `json:"error,omitempty"`
	// Rows is how many players (or teams, in the scoreboard) it carried.
	Rows int `json:"rows"`
	// Fields is every field's path, attributes as /@name, sorted.
	Fields []string `json:"fields"`
	// Example is the first row's fields with their values, member data
	// blanked.
	Example map[string]string `json:"example"`
	// Values are the distinct values, across every row, of the fields
	// that say what a figure covers.
	Values map[string][]string `json:"values"`
	// RankOrProjection is the fields whose path names a rank or a
	// projection.
	RankOrProjection []string `json:"rank_or_projection"`
}

// ProbeYahoo reads the probe for the first attached Yahoo league of the
// season whose member's connection answers it.
func ProbeYahoo(ctx context.Context, leagues YahooProbeLeagues, prober YahooProber, season int, now time.Time) (YahooProbe, error) {
	refs, err := leagues.YahooMemberLeagues(ctx, season)
	if err != nil {
		return YahooProbe{}, err
	}
	if len(refs) == 0 {
		return YahooProbe{}, fmt.Errorf("%w: no Yahoo league of %d is attached by a connected member", ErrNotConnected, season)
	}
	var failed []error
	for _, ref := range refs {
		read, err := prober.Probe(ctx, ref.As, ref.Season, ref.LeagueID)
		if err != nil {
			failed = append(failed, err)
			continue
		}
		out := YahooProbe{Probe: YahooProbeName, ReadAt: now.UTC(), Season: ref.Season, Week: read.Week}
		for _, a := range read.Answers {
			out.Answers = append(out.Answers, ShapeOf(a))
		}
		return out, nil
	}
	return YahooProbe{}, fmt.Errorf("leaguesync: yahoo probe: no league answered: %w", errors.Join(failed...))
}

// ShapeOf is an answer's shape; an answer that was not read, or does not
// read as XML, says why.
func ShapeOf(a yahoo.ProbeAnswer) ProbeShape {
	s := ProbeShape{Name: a.Name, Path: a.Path, Fields: []string{}, Example: map[string]string{}, Values: map[string][]string{}, RankOrProjection: []string{}}
	if a.Err != nil {
		s.Error = a.Err.Error()
		return s
	}
	w := &shapeWalk{shape: &s, fields: map[string]bool{}}
	if err := w.walk(a.Body); err != nil {
		s.Error = err.Error()
	}
	for f := range w.fields {
		s.Fields = append(s.Fields, f)
		if probeNamesRankOrProjection(f) {
			s.RankOrProjection = append(s.RankOrProjection, f)
		}
	}
	slices.Sort(s.Fields)
	slices.Sort(s.RankOrProjection)
	return s
}

// shapeWalk is one pass over an answer's elements.
type shapeWalk struct {
	shape  *ProbeShape
	fields map[string]bool
	stack  []string
	// text and children are the open elements' text and child counts.
	text     []strings.Builder
	children []int
	// row is the depth of the first row while it is open, -1 once closed.
	row     int
	rowName string
}

func (w *shapeWalk) walk(body []byte) error {
	d := xml.NewDecoder(bytes.NewReader(body))
	for {
		tok, err := d.Token()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("%w: %w", yahoo.ErrMalformed, err)
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if err := w.open(t); err != nil {
				return err
			}
		case xml.CharData:
			if n := len(w.text); n > 0 {
				w.text[n-1].Write(t)
			}
		case xml.EndElement:
			w.close()
		}
	}
}

func (w *shapeWalk) open(t xml.StartElement) error {
	if n := len(w.children); n > 0 {
		w.children[n-1]++
	}
	w.stack = append(w.stack, t.Name.Local)
	w.text = append(w.text, strings.Builder{})
	w.children = append(w.children, 0)
	if len(w.stack) > probeMaxDepth {
		return fmt.Errorf("%w: nested past %d", yahoo.ErrMalformed, probeMaxDepth)
	}
	name := t.Name.Local
	if (name == "player" || name == "team") && (w.rowName == "" || w.rowName == name) {
		if w.rowName == "" {
			w.rowName, w.row = name, len(w.stack)
		}
		w.shape.Rows++
	}
	for _, at := range t.Attr {
		if at.Name.Space != "" || at.Name.Local == "xmlns" {
			continue
		}
		w.leaf(w.path()+"/@"+at.Name.Local, at.Name.Local, at.Value)
	}
	return nil
}

func (w *shapeWalk) close() {
	n := len(w.stack)
	if n == 0 {
		return
	}
	if w.children[n-1] == 0 {
		w.leaf(w.path(), w.stack[n-1], strings.TrimSpace(w.text[n-1].String()))
	}
	if w.row == n {
		w.row = -1
	}
	w.stack, w.text, w.children = w.stack[:n-1], w.text[:n-1], w.children[:n-1]
}

// path is the open element's path below fantasy_content.
func (w *shapeWalk) path() string {
	if len(w.stack) > 0 && w.stack[0] == "fantasy_content" {
		return strings.Join(w.stack[1:], "/")
	}
	return strings.Join(w.stack, "/")
}

func (w *shapeWalk) leaf(path, name, value string) {
	if path == "" {
		return
	}
	w.fields[path] = true
	if probeIsMemberData(w.stack) {
		value = ""
	}
	if w.row > 0 && len(w.stack) >= w.row {
		if _, seen := w.shape.Example[path]; !seen {
			w.shape.Example[path] = value
		}
	}
	if probeSaysCoverage(name) && value != "" {
		vs := w.shape.Values[path]
		if !slices.Contains(vs, value) && len(vs) < probeValuesPerField {
			w.shape.Values[path] = append(vs, value)
		}
	}
}

// probeMemberFields are the elements whose values may name a member, a
// team or a league, or link to them: blanked wherever they open.
var probeMemberFields = map[string]bool{
	"managers": true, "manager": true, "name": true, "nickname": true, "guid": true, "email": true,
	"team_key": true, "team_id": true, "league_key": true, "league_id": true, "manager_id": true,
	"is_owned_by_current_login": true, "is_current_login": true, "is_commissioner": true,
}

func probeIsMemberData(stack []string) bool {
	for _, el := range stack {
		if probeMemberFields[el] || strings.Contains(el, "url") || strings.Contains(el, "logo") ||
			strings.Contains(el, "image") || strings.Contains(el, "headshot") {
			return true
		}
	}
	return false
}

// probeSaysCoverage is a field that says what a figure covers.
func probeSaysCoverage(name string) bool {
	switch name {
	case "week", "season", "date", "rank_season", "coverage_value", "stat_id":
		return true
	}
	return strings.HasSuffix(name, "_type") || strings.HasPrefix(name, "is_projected")
}

func probeNamesRankOrProjection(path string) bool {
	return strings.Contains(path, "rank") || strings.Contains(path, "project")
}

// YahooMemberLeagues is every attached Yahoo league of the season once,
// with an account that attached it to be read as themselves and whose
// connection is live, the first to attach first.
func (s *Store) YahooMemberLeagues(ctx context.Context, season int) ([]Ref, error) {
	rows, err := s.Pool.Query(ctx, `select distinct on (l.host_league_id) l.host_league_id, l.host_season, l.account_id
	from app.league_links l
	join app.host_connections c on c.account_id = l.account_id and c.host = l.host and c.status = 'connected'
	where l.host = 'yahoo' and l.read_as_member and l.detached_at is null and l.host_season = $1
	order by l.host_league_id, l.attached_at, l.id`, season)
	if err != nil {
		return nil, fmt.Errorf("leaguesync: yahoo member leagues: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Ref, error) {
		ref := Ref{Host: HostYahoo}
		return ref, r.Scan(&ref.LeagueID, &ref.Season, &ref.As)
	})
	if err != nil {
		return nil, fmt.Errorf("leaguesync: yahoo member leagues: %w", err)
	}
	return out, nil
}
