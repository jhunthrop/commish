package boards

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/memo"
)

// ErrCustomUnavailable is a league's own rules asked for while the boards
// service is not configured or cannot answer: the room says so rather
// than ranking the league on a stored board it does not score by.
var ErrCustomUnavailable = errors.New("boards: a board for this league's own scoring cannot be built right now")

// CustomUnavailableWords is what a room says when a league's own scoring
// cannot be built right now, the one sentence solo and the companion use.
const CustomUnavailableWords = "We cannot build your league's board right now. Try again in a moment"

// ErrCustomRefused is the boards service refusing a request the api built
// (a 400): a contract bug between the two, never a reason to try again.
var ErrCustomRefused = errors.New("boards: the boards service refused the request")

// The service's answer bounds: a stored board holds about 700 players.
const (
	maxCustomRows     = 3000
	maxCustomResponse = 4 << 20
	maxRowPoints      = 2000
)

var universeID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)

// ScoredDirectory joins a board scored elsewhere to the provider's
// roster. *PGSource implements it.
type ScoredDirectory interface {
	LoadScored(ctx context.Context, f Format, source string, asOf time.Time, points map[string]Projection) (*Raw, error)
}

// CustomSource is the research boards service (research/boards): the
// served generation's candidates scored under a league's exact rules.
// Each rules set's board is kept for TTL (the stored board changes
// nightly) and built once however many rooms ask for it at the same time.
type CustomSource struct {
	// BaseURL is BOARDS_URL.
	BaseURL string
	// Client calls it, with a Google identity token in production.
	Client *http.Client
	// Season is the season the board drafts for.
	Season int
	// Directory is the provider's roster the board's universe ids are
	// joined to, the same one the stored boards are read through.
	Directory ScoredDirectory
	TTL       time.Duration
	Now       func() time.Time

	kept     memo.Map[string, keptCustom]
	building singleflight.Group
}

type keptCustom struct {
	raw *Raw
	at  time.Time
}

type wireShape struct {
	Teams int                `json:"teams"`
	Slots []draft.SlotConfig `json:"slots"`
}

type wireCustom struct {
	Season int                   `json:"season"`
	Rules  apitypes.ScoringRules `json:"rules"`
	Shape  wireShape             `json:"shape"`
}

type wireRow struct {
	PlayerID        string  `json:"player_id"`
	ProjectedPoints float64 `json:"projected_points"`
	FloorPoints     float64 `json:"floor_points"`
	MedianPoints    float64 `json:"median_points"`
	CeilingPoints   float64 `json:"ceiling_points"`
}

type wireCustomResponse struct {
	OK    bool    `json:"ok"`
	Error *string `json:"error"`
	Data  struct {
		Season int       `json:"season"`
		Source string    `json:"source"`
		AsOf   time.Time `json:"as_of"`
		Rows   []wireRow `json:"rows"`
	} `json:"data"`
}

// RulesHash keys a rules set: the same rules, the same board.
func RulesHash(r apitypes.ScoringRules) string {
	raw, err := json.Marshal(r)
	if err != nil {
		panic(fmt.Sprintf("boards: a struct of float64s always encodes: %v", err))
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// Load is the board for a league's exact rules. teams and slots are the
// league's, which the service values the board for; the api values it
// again per league (For), so the kept board serves every shape.
func (c *CustomSource) Load(ctx context.Context, rules apitypes.ScoringRules, teams int, slots []draft.SlotConfig) (*Raw, error) {
	if c == nil || c.BaseURL == "" {
		return nil, ErrCustomUnavailable
	}
	key := RulesHash(rules)
	if k, ok := c.kept.Get(key); ok && c.Now().Sub(k.at) <= c.TTL {
		return k.raw, nil
	}
	v, err, _ := c.building.Do(key, func() (any, error) {
		if k, ok := c.kept.Get(key); ok && c.Now().Sub(k.at) <= c.TTL {
			return k.raw, nil
		}
		raw, err := c.fetch(context.WithoutCancel(ctx), rules, teams, slots)
		if err != nil {
			return nil, err
		}
		c.kept.Put(key, keptCustom{raw: raw, at: c.Now()})
		return raw, nil
	})
	if err != nil {
		return nil, err
	}
	return v.(*Raw), nil
}

func (c *CustomSource) fetch(ctx context.Context, rules apitypes.ScoringRules, teams int, slots []draft.SlotConfig) (*Raw, error) {
	body, err := json.Marshal(wireCustom{Season: c.Season, Rules: rules, Shape: wireShape{Teams: teams, Slots: slots}})
	if err != nil {
		return nil, fmt.Errorf("boards: encode the custom request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.BaseURL, "/")+"/boards/custom", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("boards: custom request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrCustomUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	var wire wireCustomResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxCustomResponse)).Decode(&wire); err != nil {
		return nil, fmt.Errorf("%w: decode (status %d): %w", ErrCustomUnavailable, resp.StatusCode, err)
	}
	if resp.StatusCode == http.StatusBadRequest {
		msg := ""
		if wire.Error != nil {
			msg = *wire.Error
		}
		return nil, fmt.Errorf("%w: %s", ErrCustomRefused, msg)
	}
	if resp.StatusCode != http.StatusOK || !wire.OK {
		msg := ""
		if wire.Error != nil {
			msg = *wire.Error
		}
		return nil, fmt.Errorf("%w: status %d: %s", ErrCustomUnavailable, resp.StatusCode, msg)
	}
	return c.raw(ctx, wire)
}

// raw checks the answer (the api trusts no service's shape) and joins it
// to the directory.
func (c *CustomSource) raw(ctx context.Context, wire wireCustomResponse) (*Raw, error) {
	d := wire.Data
	f, ok := FormatOfSource(d.Source)
	switch {
	case !ok:
		return nil, fmt.Errorf("%w: the service named no stored board (%q)", ErrCustomUnavailable, d.Source)
	case d.Season != c.Season:
		return nil, fmt.Errorf("%w: the service answered %d, not %d", ErrCustomUnavailable, d.Season, c.Season)
	case len(d.Rows) == 0 || len(d.Rows) > maxCustomRows:
		return nil, fmt.Errorf("%w: %d rows", ErrCustomUnavailable, len(d.Rows))
	}
	points := make(map[string]Projection, len(d.Rows))
	for _, r := range d.Rows {
		if !universeID.MatchString(r.PlayerID) || !finiteWithin(r.ProjectedPoints, r.FloorPoints, r.MedianPoints, r.CeilingPoints) {
			return nil, fmt.Errorf("%w: a row that cannot be (%q)", ErrCustomUnavailable, r.PlayerID)
		}
		points[r.PlayerID] = Projection{Points: r.ProjectedPoints, Floor: r.FloorPoints, Median: r.MedianPoints, Ceiling: r.CeilingPoints}
	}
	return c.Directory.LoadScored(ctx, f, d.Source, d.AsOf, points)
}

func finiteWithin(vs ...float64) bool {
	for _, v := range vs {
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > maxRowPoints {
			return false
		}
	}
	return true
}
