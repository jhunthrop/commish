package boards

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
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
	// Note is the capture's words on it, the roster sweep's description;
	// the by-date list carries none.
	Note string
	AsOf time.Time
	// Source is the capture's feed in the store.
	Source string
	// Since is the first capture of his unbroken run under a season-long
	// status, nil for a week's designation and for a run that reaches the
	// oldest capture read (we do not know when it began).
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
// capture exists. A newest capture over the byte cap or that does not
// parse gives way to the newest one that does, with its own stamp. A
// season-long designation on the by-date list is dated by its run
// (designationRuns). The sources and payload shapes are
// research/capsules/facts/depth_reads.py's.
func (s *PGSource) Designations(ctx context.Context) (map[string]Designation, error) {
	for _, source := range []string{injuriesByDate, injuriesRosterWide} {
		out, found, err := s.newestCapture(ctx, source)
		if err != nil {
			return nil, err
		}
		if !found {
			continue
		}
		if source == injuriesByDate && len(out) > 0 {
			if err := s.dateSeasonRuns(ctx, out); err != nil {
				return nil, err
			}
		}
		return out, nil
	}
	return map[string]Designation{}, nil
}

// capturesTried is how many of a source's newest captures are tried
// before the read gives up on them.
const capturesTried = 5

// newestCapture is the source's newest capture that parses, found false
// when the source has none at all.
func (s *PGSource) newestCapture(ctx context.Context, source string) (map[string]Designation, bool, error) {
	rows, err := s.Pool.Query(ctx, `select case when octet_length(payload::text) <= $2 then payload end, captured_at
		from `+s.table("capture_snapshots")+` where source = $1 order by captured_at desc limit $3`,
		source, maxCaptureBytes, capturesTried)
	if err != nil {
		return nil, false, fmt.Errorf("boards: read injury capture %s: %w", source, err)
	}
	type capture struct {
		payload []byte
		at      time.Time
	}
	var captures []capture
	for rows.Next() {
		var c capture
		if err := rows.Scan(&c.payload, &c.at); err != nil {
			rows.Close()
			return nil, false, fmt.Errorf("boards: scan injury capture %s: %w", source, err)
		}
		captures = append(captures, c)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("boards: read injury capture %s: %w", source, err)
	}
	var lastErr error
	for _, c := range captures {
		if c.payload == nil {
			lastErr = fmt.Errorf("boards: an injury capture %s of %v is over %d bytes", source, c.at, maxCaptureBytes)
			continue
		}
		entries, err := parseCapture(source, c.payload)
		if err != nil {
			lastErr = err
			continue
		}
		out := make(map[string]Designation, len(entries))
		for id, e := range entries {
			out[id] = Designation{Code: e.code, Note: e.note, AsOf: c.at.UTC(), Source: source}
		}
		return out, true, nil
	}
	if len(captures) == 0 {
		return nil, false, nil
	}
	return nil, true, fmt.Errorf("boards: none of the %d newest injury captures %s reads: %w", len(captures), source, lastErr)
}

// The run read looks back this far and over at most this many captures
// (hourly, so about two months): a run that reaches its oldest has no
// date.
const (
	runWindow      = 60 * 24 * time.Hour
	maxRunCaptures = 2000
)

// dateSeasonRuns dates each season-long designation of the newest
// by-date capture (out) by the first capture of his unbroken run under
// that status, from the captures at or before it in the window. A capture
// whose list does not read is skipped, never a break in a run.
func (s *PGSource) dateSeasonRuns(ctx context.Context, out map[string]Designation) error {
	var newest time.Time
	for _, d := range out {
		newest = d.AsOf
		break
	}
	codes, statuses := seasonLongCodes()
	query := `with caps as (
  select payload, captured_at, row_number() over (order by captured_at desc) as n
  from ` + s.table("capture_snapshots") + `
  where source = $1 and captured_at <= $2 and captured_at > $3 and jsonb_typeof(payload->'injList') = 'array'
  order by captured_at desc limit $4
), listed as (
  select c.n, c.captured_at, btrim(e->>'playerID') as player_id, m.status
  from caps c cross join lateral jsonb_array_elements(c.payload->'injList') as e
  join unnest($5::text[], $6::text[]) as m(code, status) on m.code = upper(btrim(e->>'designation'))
), runs as (
  select player_id, status, n, captured_at, n - row_number() over (partition by player_id, status order by n) as gap
  from listed
)
select player_id, status, min(captured_at), max(n) < (select count(*) from caps)
from runs where gap = 0 group by player_id, status`
	rows, err := s.Pool.Query(ctx, query, injuriesByDate, newest, newest.Add(-runWindow), maxRunCaptures, codes, statuses)
	if err != nil {
		return fmt.Errorf("boards: read injury runs: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, status string
		var since time.Time
		var bounded bool
		if err := rows.Scan(&id, &status, &since, &bounded); err != nil {
			return fmt.Errorf("boards: scan injury runs: %w", err)
		}
		d, ok := out[id]
		if !ok || !bounded || d.Status() != status {
			continue
		}
		since = since.UTC()
		d.Since = &since
		out[id] = d
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("boards: read injury runs: %w", err)
	}
	return nil
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
