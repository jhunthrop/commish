package boards

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// The injury captures (the hourly capture job): the by-date list is the
// source, the roster sweep stands in when no by-date capture exists. The
// newest capture is a few hundred KB.
const (
	maxCaptureBytes    = 4 << 20
	maxCaptureEntries  = 5000
	injuriesByDate     = "tank01_injuries_by_date"
	injuriesRosterWide = "tank01_injuries"
)

// Designation is one player's injury designation as the provider's
// capture lists it ("Q", "D", "O", "IR" and the like), and the capture's
// stamp.
type Designation struct {
	Code string
	// Note is the capture's words on it: the roster sweep's description,
	// on a by-date out from the newest sweep within noteWindow.
	Note string
	// AsOf is the capture's stamp: when the list last changed (the
	// capture stores a list only when it differs from the last one).
	AsOf time.Time
	// Source is the capture's feed in the store.
	Source string
	// CheckedAt is the capture job's last successful check of the feed
	// (research.capture_checks), nil when the store records none.
	CheckedAt *time.Time
	// Since is the first capture of his unbroken run under a season-long
	// status (WithSince), nil for a week's designation, for a run that
	// reaches the oldest capture read (we do not know when it began), and
	// on the in-season screens' read, which does not date.
	Since *time.Time
}

// Status is the designation in the contract's words, "" for a code we
// do not know.
func (d Designation) Status() string { return StatusOf(d.Code) }

// SeasonLong is a designation that keeps him out for weeks (SeasonLong).
func (d Designation) SeasonLong() bool { return SeasonLong(d.Status(), d.Note) }

// Designations is the newest injury capture, by the board's player id.
// Each capture is the provider's whole current list, so the newest stamp
// wins outright: a player it does not name has no designation, whatever
// an older capture said. The by-date list is the source (research's
// current-status read); the roster sweep stands in only when no by-date
// capture exists. A newest capture over the byte cap, that does not
// parse, or that falls below the floor (readableAt) gives way to the
// newest one that reads, with its own stamp. A by-date out takes the
// note of the newest roster sweep near it, so out for the season can
// count. The sources and payload shapes are
// research/capsules/facts/depth_reads.py's; research/nightly/designations.py
// reads the same.
func (s *PGSource) Designations(ctx context.Context) (map[string]Designation, error) {
	for _, source := range []string{injuriesByDate, injuriesRosterWide} {
		out, found, err := s.newestCapture(ctx, source)
		if err != nil {
			return nil, err
		}
		if !found {
			continue
		}
		checked, err := s.lastChecked(ctx, source)
		if err != nil {
			return nil, err
		}
		for id, d := range out {
			d.CheckedAt = checked
			out[id] = d
		}
		if source == injuriesByDate {
			s.noteOuts(ctx, out)
		}
		return out, nil
	}
	return map[string]Designation{}, nil
}

// capturesTried is how many of a source's newest captures are tried
// before the read gives up on them.
const capturesTried = 5

type capture struct {
	payload []byte
	at      time.Time
	entries map[string]captured
	err     error
}

// newestCapture is the source's newest capture that reads, found false
// when the source has none at all.
func (s *PGSource) newestCapture(ctx context.Context, source string) (map[string]Designation, bool, error) {
	captures, err := s.captures(ctx, source, capturesTried+1, time.Time{})
	if err != nil {
		return nil, false, err
	}
	if len(captures) == 0 {
		return nil, false, nil
	}
	var lastErr error
	for i := 0; i < len(captures) && i < capturesTried; i++ {
		c := captures[i]
		if err := readableAt(captures, i); err != nil {
			lastErr = err
			continue
		}
		out := make(map[string]Designation, len(c.entries))
		for id, e := range c.entries {
			out[id] = Designation{Code: e.code, Note: e.note, AsOf: c.at.UTC(), Source: source}
		}
		return out, true, nil
	}
	tried := min(len(captures), capturesTried)
	return nil, true, fmt.Errorf("boards: none of the %d newest injury captures %s reads: %w", tried, source, lastErr)
}

// captures is the source's newest n captures, newest first, each parsed,
// at or before before when it is set.
func (s *PGSource) captures(ctx context.Context, source string, n int, before time.Time) ([]capture, error) {
	query := `select case when octet_length(payload::text) <= $2 then payload end, captured_at
		from ` + s.table("capture_snapshots") + ` where source = $1 and ($4::timestamptz is null or captured_at <= $4)
		order by captured_at desc limit $3`
	var at any
	if !before.IsZero() {
		at = before
	}
	rows, err := s.Pool.Query(ctx, query, source, maxCaptureBytes, n, at)
	if err != nil {
		return nil, fmt.Errorf("boards: read injury capture %s: %w", source, err)
	}
	defer rows.Close()
	var out []capture
	for rows.Next() {
		var c capture
		if err := rows.Scan(&c.payload, &c.at); err != nil {
			return nil, fmt.Errorf("boards: scan injury capture %s: %w", source, err)
		}
		if c.payload == nil {
			c.err = fmt.Errorf("boards: an injury capture %s of %v is over %d bytes", source, c.at, maxCaptureBytes)
		} else {
			c.entries, c.err = parseCapture(source, c.payload)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("boards: read injury capture %s: %w", source, err)
	}
	return out, nil
}

// readableAt is nil when captures[i] reads: it parses, lists someone, and
// lists at least half as many as the newest list before it that does (a cut-short or
// empty list from the provider is a glitch, never everyone cleared). The
// next capture after a real drop compares with the short one and reads.
// research/nightly/designations.py holds the same floor.
func readableAt(captures []capture, i int) error {
	c := captures[i]
	if c.err != nil {
		return c.err
	}
	if len(c.entries) == 0 {
		return fmt.Errorf("boards: the injury capture of %v lists nobody", c.at)
	}
	for _, prev := range captures[i+1:] {
		if prev.err != nil || len(prev.entries) == 0 {
			continue
		}
		if 2*len(c.entries) < len(prev.entries) {
			return fmt.Errorf("boards: the injury capture of %v lists %d, under half the %d before it", c.at, len(c.entries), len(prev.entries))
		}
		break
	}
	return nil
}

// lastChecked is the capture job's last successful check of the source,
// nil when the store records none (research.capture_checks, revision
// 0008; the api can deploy ahead of it).
func (s *PGSource) lastChecked(ctx context.Context, source string) (*time.Time, error) {
	// Readable, not only present: a migration whose grants have not reached
	// the api's role leaves the check unknown ("as the list stood"), never
	// the screens without their statuses.
	var readable bool
	err := s.Pool.QueryRow(ctx, `select coalesce(has_table_privilege(to_regclass($1), 'select'), false)`,
		s.table("capture_checks")).Scan(&readable)
	if err != nil {
		return nil, fmt.Errorf("boards: look for capture_checks: %w", err)
	}
	if !readable {
		return nil, nil
	}
	var at time.Time
	err = s.Pool.QueryRow(ctx, `select checked_at from `+s.table("capture_checks")+` where source = $1`, source).Scan(&at)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("boards: read capture_checks %s: %w", source, err)
	}
	at = at.UTC()
	return &at, nil
}

// noteWindow is how far a roster sweep's note reaches a by-date out.
const noteWindow = 48 * time.Hour

// noteOuts gives each by-date out the newest roster sweep's note on him
// within noteWindow of the list, so "out for the season" can count. A
// sweep that cannot be read leaves the outs as they are, logged.
func (s *PGSource) noteOuts(ctx context.Context, out map[string]Designation) {
	var at time.Time
	outs := false
	for _, d := range out {
		at = d.AsOf
		outs = outs || d.Status() == StatusOut
	}
	if !outs {
		return
	}
	sweeps, err := s.captures(ctx, injuriesRosterWide, 1, at.Add(noteWindow))
	if err != nil || len(sweeps) == 0 || sweeps[0].err != nil || sweeps[0].at.Before(at.Add(-noteWindow)) {
		if err == nil && len(sweeps) > 0 {
			err = sweeps[0].err
		}
		if err != nil {
			slog.Warn("boards: the roster sweep's notes were not read; a by-date out stays a week's", "err", err)
		}
		return
	}
	for id, d := range out {
		if e, ok := sweeps[0].entries[id]; ok && d.Status() == StatusOut && e.note != "" {
			d.Note = e.note
			out[id] = d
		}
	}
}

// The run read looks back this far and over at most this many captures
// (hourly, so about two months): a run that reaches its oldest has no
// date.
const (
	runWindow      = 60 * 24 * time.Hour
	maxRunCaptures = 2000
)

// RunKey is a player under a status.
type RunKey struct {
	PlayerID string
	Status   string
}

// SeasonRuns is, for each player the by-date capture at newest lists
// under a season-long status, the first capture of his unbroken run
// under it, from the captures at or before newest in the window. A run
// that reaches the window's oldest capture is left out (no date). A
// capture whose list does not read, or that falls below the floor, is
// skipped, never a break in a run.
func (s *PGSource) SeasonRuns(ctx context.Context, newest time.Time) (map[RunKey]time.Time, error) {
	codes, statuses := seasonLongCodes()
	query := `with listed_caps as (
  select payload, captured_at, jsonb_array_length(payload->'injList') as n_listed
  from ` + s.table("capture_snapshots") + `
  where source = $1 and captured_at <= $2 and captured_at > $3 and jsonb_typeof(payload->'injList') = 'array'
), floored as (
  select payload, captured_at, n_listed, lead(n_listed) over (order by captured_at desc) as n_before
  from listed_caps where n_listed > 0
), caps as (
  select payload, captured_at, row_number() over (order by captured_at desc) as n
  from floored
  where n_before is null or 2 * n_listed >= n_before
  order by captured_at desc limit $4
), listed as (
  select c.n, c.captured_at, btrim(e->>'playerID') as player_id, m.status
  from caps c cross join lateral jsonb_array_elements(c.payload->'injList') as e
  join unnest($5::text[], $6::text[]) as m(code, status) on m.code = upper(btrim(e->>'designation'))
), runs as (
  select player_id, status, n, captured_at, n - row_number() over (partition by player_id, status order by n) as gap
  from listed
)
select player_id, status, min(captured_at)
from runs where gap = 0 group by player_id, status
having max(n) < (select count(*) from caps)`
	rows, err := s.Pool.Query(ctx, query, injuriesByDate, newest, newest.Add(-runWindow), maxRunCaptures, codes, statuses)
	if err != nil {
		return nil, fmt.Errorf("boards: read injury runs: %w", err)
	}
	defer rows.Close()
	out := map[RunKey]time.Time{}
	for rows.Next() {
		var k RunKey
		var since time.Time
		if err := rows.Scan(&k.PlayerID, &k.Status, &since); err != nil {
			return nil, fmt.Errorf("boards: scan injury runs: %w", err)
		}
		out[k] = since.UTC()
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("boards: read injury runs: %w", err)
	}
	return out, nil
}

// Newest is the stamp of the capture the designations come from, zero
// with none.
func Newest(designations map[string]Designation) time.Time {
	var at time.Time
	for _, d := range designations {
		if d.AsOf.After(at) {
			at = d.AsOf
		}
	}
	return at
}

// WithSince is the designations with each season-long one dated by its
// run; the map handed in is not changed.
func WithSince(designations map[string]Designation, runs map[RunKey]time.Time) map[string]Designation {
	out := make(map[string]Designation, len(designations))
	for id, d := range designations {
		if since, ok := runs[RunKey{id, d.Status()}]; ok && d.SeasonLong() {
			d.Since = &since
		}
		out[id] = d
	}
	return out
}

type captureEntry struct {
	PlayerID    string `json:"playerID"`
	Designation string `json:"designation"`
	Injury      *struct {
		Designation string `json:"designation"`
		Description string `json:"description"`
	} `json:"injury"`
	note string
}

// captured is one player's entry in a capture: his code and its note.
type captured struct {
	code string
	note string
}

// parseCapture is a capture's designation by player: the by-date list's
// injList, or the roster sweep's nested injury per rostered player with
// its description as the note.
func parseCapture(source string, payload []byte) (map[string]captured, error) {
	var entries []captureEntry
	if source == injuriesRosterWide {
		var teams []struct {
			Roster []captureEntry `json:"roster"`
		}
		if err := json.Unmarshal(payload, &teams); err != nil {
			return nil, fmt.Errorf("boards: injury capture %s: %w", source, err)
		}
		for _, t := range teams {
			for _, e := range t.Roster {
				if e.Injury != nil {
					e.Designation, e.note = e.Injury.Designation, strings.TrimSpace(e.Injury.Description)
					entries = append(entries, e)
				}
			}
		}
	} else {
		var list struct {
			InjList []captureEntry `json:"injList"`
		}
		if err := json.Unmarshal(payload, &list); err != nil {
			return nil, fmt.Errorf("boards: injury capture %s: %w", source, err)
		}
		entries = list.InjList
	}
	if len(entries) > maxCaptureEntries {
		return nil, fmt.Errorf("boards: injury capture %s lists over %d players", source, maxCaptureEntries)
	}
	out := make(map[string]captured, len(entries))
	for _, e := range entries {
		id, code := strings.TrimSpace(e.PlayerID), strings.TrimSpace(e.Designation)
		if id != "" && code != "" {
			out[id] = captured{code: code, note: e.note}
		}
	}
	return out, nil
}
