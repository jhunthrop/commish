package boards

import (
	"context"
	"crypto/sha256"
	_ "embed" // the run read's text, designation_runs.sql
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/jhunthrop/commish/api/internal/season"
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
	// reaches the oldest capture read (we do not know when it began). The
	// board route and the in-season screens both read it dated (Lane 66n).
	Since *time.Time
	// Listed is the first capture of his unbroken run under this status,
	// any status (WithSince): when the provider listed him so, a week's
	// designation too. Nil for a run that reaches the oldest capture read,
	// or an undated read. The in-season screens tell by it whether a week's
	// designation came before or after his club's last game (Lane 95).
	Listed *time.Time
	// ReturnOn is the day the provider expects him back, midnight Eastern:
	// the player list's injReturnDate (returnDates), nil when that list does
	// not date him under this same status or its date does not read.
	ReturnOn *time.Time
	// DatingPending is a capture served before its dating was read (the
	// runs read failed with no dated pair kept, a cold start): Listed and
	// Since are not known yet rather than absent, so a screen says the
	// designation alone, never "still listed" or carried over, until the
	// dating lands (Lane 116, B91).
	DatingPending bool
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
		out, storedNewest, found, err := s.newestCapture(ctx, source)
		if err != nil {
			return nil, err
		}
		if !found {
			continue
		}
		// The feed's last check is this list's only when it is the newest
		// stored: a check that returned a list the floor refused never
		// vouches for the older list shown.
		var checked *time.Time
		if storedNewest {
			if checked, err = s.lastChecked(ctx, source); err != nil {
				return nil, err
			}
		}
		for id, d := range out {
			d.CheckedAt = checked
			out[id] = d
		}
		if source == injuriesByDate {
			s.noteOuts(ctx, out)
		}
		s.returnDates(ctx, out)
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

// newestCapture is the source's newest capture that reads, storedNewest
// when it is the newest the source stores, found false when the source
// has none at all.
func (s *PGSource) newestCapture(ctx context.Context, source string) (out map[string]Designation, storedNewest, found bool, err error) {
	captures, err := s.captures(ctx, source, capturesTried+1, time.Time{})
	if err != nil {
		return nil, false, false, err
	}
	if len(captures) == 0 {
		return nil, false, false, nil
	}
	var lastErr error
	for i := 0; i < len(captures) && i < capturesTried; i++ {
		c := captures[i]
		if err := readableAt(captures, i); err != nil {
			lastErr = err
			continue
		}
		return designationsOf(source, c), i == 0, true, nil
	}
	tried := min(len(captures), capturesTried)
	return nil, false, true, fmt.Errorf("boards: none of the %d newest injury captures %s reads: %w", tried, source, lastErr)
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

// playerList is the player list research reads once a day (Lane 110,
// B79): the one provider feed carrying each listed player's expected
// return (injury.injReturnDate, YYYYMMDD). Its newest capture within
// noteWindow of the designations' list dates them, as a roster sweep's
// notes do.
const playerList = "tank01_player_list"

// listedReturn is one player's entry on the player list: his designation
// in the provider's words and the return date it gives.
type listedReturn struct {
	code string
	date string
}

// returnDates gives each designation the player list's return date for
// him (ReturnOnOf). A list that cannot be read leaves every designation
// undated, logged; a list too far from the designations' leaves them
// undated.
func (s *PGSource) returnDates(ctx context.Context, out map[string]Designation) {
	at := Newest(out)
	if at.IsZero() {
		return
	}
	listedAt, listed, err := s.listedReturns(ctx, at.Add(noteWindow))
	if err != nil {
		slog.Warn("boards: the player list's return dates were not read; the designations answer undated", "err", err)
		return
	}
	if listedAt.IsZero() || listedAt.Before(at.Add(-noteWindow)) {
		return
	}
	for id, d := range out {
		e, ok := listed[id]
		if !ok {
			continue
		}
		if on, ok := ReturnOnOf(e.code, e.date, d.Status(), listedAt); ok {
			d.ReturnOn = &on
			out[id] = d
		}
	}
}

// listedReturns is the newest player list at or before before: its stamp
// and each player it gives a return date, by player id. A zero stamp is
// no list. The list is never loaded whole (it is some 4 MB): the store
// picks out the dated entries.
func (s *PGSource) listedReturns(ctx context.Context, before time.Time) (time.Time, map[string]listedReturn, error) {
	query := `with newest as (
  select payload, captured_at from ` + s.table("capture_snapshots") + `
  where source = $1 and captured_at <= $2 order by captured_at desc limit 1
)
select n.captured_at, jsonb_typeof(n.payload) = 'array', btrim(coalesce(e->>'playerID', '')),
  coalesce(e->'injury'->>'designation', ''), btrim(coalesce(e->'injury'->>'injReturnDate', ''))
from newest n left join lateral jsonb_array_elements(case when jsonb_typeof(n.payload) = 'array' then n.payload else '[]'::jsonb end) as e
  on jsonb_typeof(e) = 'object' and jsonb_typeof(e->'injury') = 'object' and btrim(coalesce(e->'injury'->>'injReturnDate', '')) <> ''
limit $3`
	rows, err := s.Pool.Query(ctx, query, playerList, before, maxCaptureEntries+1)
	if err != nil {
		return time.Time{}, nil, fmt.Errorf("boards: read the player list: %w", err)
	}
	defer rows.Close()
	var at time.Time
	out := map[string]listedReturn{}
	n := 0
	for rows.Next() {
		var list bool
		var id string
		var e listedReturn
		if err := rows.Scan(&at, &list, &id, &e.code, &e.date); err != nil {
			return time.Time{}, nil, fmt.Errorf("boards: scan the player list: %w", err)
		}
		if !list {
			return time.Time{}, nil, fmt.Errorf("boards: the player list of %v is not a list", at)
		}
		if n++; n > maxCaptureEntries {
			return time.Time{}, nil, fmt.Errorf("boards: the player list dates over %d players", maxCaptureEntries)
		}
		if id != "" {
			out[id] = e
		}
	}
	if err := rows.Err(); err != nil {
		return time.Time{}, nil, fmt.Errorf("boards: read the player list: %w", err)
	}
	return at.UTC(), out, nil
}

// returnDateLayout is the provider's YYYYMMDD.
const returnDateLayout = "20060102"

// ReturnOnOf is the player list's return date for a designation, midnight
// Eastern, false unless it reads strictly: the list names him under the
// same status (code in the provider's words, status the designation's), and
// the date is a real YYYYMMDD day no earlier than the list's own Eastern
// day (an earlier one is a date the provider let pass, not a return). A
// missing or unparseable date is no date, never a guess.
func ReturnOnOf(code, date, status string, listedAt time.Time) (time.Time, bool) {
	if status == "" || StatusOf(code) != status || len(date) != len(returnDateLayout) {
		return time.Time{}, false
	}
	east := season.Eastern()
	on, err := time.ParseInLocation(returnDateLayout, date, east)
	if err != nil {
		return time.Time{}, false
	}
	listed := listedAt.In(east)
	if on.Before(time.Date(listed.Year(), listed.Month(), listed.Day(), 0, 0, 0, 0, east)) {
		return time.Time{}, false
	}
	return on, true
}

// The run read looks back this far and over at most this many captures
// (hourly, so about two months): a run that reaches its oldest has no
// date.
const (
	runWindow      = 60 * 24 * time.Hour
	maxRunCaptures = 2000
)

// runsQuery is the run read (DesignationRuns), one text for both lanes:
// research/nightly/designation_runs.py holds the same text, pinned to this
// file by its tests, so the capture job dates a capture as the API does
// (Lane 134). The capture table is {{capture_snapshots}}; the parameters
// are named (:source and the like), made positional by runsSQL.
//
//go:embed designation_runs.sql
var runsQuery string

// runsBinds is the run read's parameters in the order DesignationRuns
// passes them.
var runsBinds = []string{"source", "newest", "oldest", "most", "codes", "statuses"}

// runsBind is a named parameter in runsQuery (the text holds no "::"
// cast, so every colon before a name is one).
var runsBind = regexp.MustCompile(`:[a-z_]+`)

// runsSQL is runsQuery over table with its parameters positional ($1 for
// :source and so on). A name runsBinds does not hold panics: the text is
// embedded, so the first read in any test shows it.
func runsSQL(table string) string {
	position := make(map[string]string, len(runsBinds))
	for i, name := range runsBinds {
		position[":"+name] = "$" + strconv.Itoa(i+1)
	}
	query := runsBind.ReplaceAllStringFunc(runsQuery, func(name string) string {
		p, ok := position[name]
		if !ok {
			panic("boards: the run read names an unknown parameter " + name)
		}
		return p
	})
	return strings.ReplaceAll(query, "{{capture_snapshots}}", table)
}

// RunsVersion names what DesignationRuns answers for a capture: a digest
// of everything it reads by besides the captures (the query's text, the
// window, the capture cap and the code table), so a change to any of them
// is a new version without anyone bumping it (B114) and a dating kept
// under an old reading is never taken for the new one. The capture job
// derives the same version from the same inputs
// (research/nightly/designation_runs.py); both are pinned by
// api/testdata/designation-dating.json.
func RunsVersion() string { return runsVersion }

var runsVersion = runsVersionOf(runsQuery, runWindow, maxRunCaptures)

// runsVersionOf is "runs-" and the first 16 hex of the sha256 of the
// inputs' canonical lines: the query's sha256, the window in seconds, the
// capture cap, then each code and its status in code order.
func runsVersionOf(query string, window time.Duration, captures int) string {
	sum := sha256.Sum256([]byte(query))
	var b strings.Builder
	b.WriteString("query " + hex.EncodeToString(sum[:]) + "\n")
	b.WriteString("window_seconds " + strconv.FormatInt(int64(window/time.Second), 10) + "\n")
	b.WriteString("captures " + strconv.Itoa(captures) + "\n")
	codes, statuses := runCodes()
	for i, code := range codes {
		b.WriteString("code " + code + "\t" + statuses[i] + "\n")
	}
	version := sha256.Sum256([]byte(b.String()))
	return "runs-" + hex.EncodeToString(version[:])[:16]
}

// RunKey is a player under a status.
type RunKey struct {
	PlayerID string
	Status   string
}

// DesignationRuns is, for each player the by-date capture at newest lists
// under any status, the first capture of his unbroken run under it, from the captures at or before newest in the window. A run
// that reaches the window's oldest capture is left out (no date). A
// capture whose list does not read, or that falls below the floor, is
// skipped, never a break in a run.
//
// Each capture's count is taken once (Lane 129): listed_caps is read by
// both window steps after it, and inlined (Postgres's default for a CTE
// read once) its count subquery ran three times per capture, re-parsing
// every list in the window thrice; that read ran past the cache's five
// seconds in production from 2026-10-18 on.
func (s *PGSource) DesignationRuns(ctx context.Context, newest time.Time) (map[RunKey]time.Time, error) {
	codes, statuses := runCodes()
	rows, err := s.Pool.Query(ctx, runsSQL(s.table("capture_snapshots")), injuriesByDate, newest, newest.Add(-runWindow), maxRunCaptures, codes, statuses)
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

// WithSince is the designations with each one's run start as Listed, and
// each season-long one dated by it as Since; the map handed in is not
// changed.
func WithSince(designations map[string]Designation, runs map[RunKey]time.Time) map[string]Designation {
	out := make(map[string]Designation, len(designations))
	for id, d := range designations {
		since, ok := runs[RunKey{id, d.Status()}]
		if !ok {
			out[id] = d
			continue
		}
		listed := since
		d.Listed = &listed
		// Since dates the statuses that are season-long by their code alone,
		// as before the run read took every status: an out the note makes
		// season-long began its run as a week's out, so its start is no since.
		if d.SeasonLong() && SeasonLong(d.Status(), "") {
			d.Since = &since
		}
		out[id] = d
	}
	return out
}

// DatingPending is the designations marked DatingPending, undated until
// their runs are read; the map handed in is not changed.
func DatingPending(designations map[string]Designation) map[string]Designation {
	out := make(map[string]Designation, len(designations))
	for id, d := range designations {
		d.DatingPending = true
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
