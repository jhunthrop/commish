package companion

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/advisor"
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// checker answers Can from one switch, the way a pass that lapses and is
// restored looks to the companion.
type checker struct{ live bool }

func (c *checker) Can(_ context.Context, _ uuid.UUID, f entitlements.Feature, _ time.Time) (bool, error) {
	return c.live && f == entitlements.LiveDraftAdvisor, nil
}

// storedRepo holds one companion with its report already stored. Any
// other call fails the test by its nil embedded interface.
type storedRepo struct {
	Repository
	row Row
}

func (s storedRepo) Get(_ context.Context, accountID, id uuid.UUID) (Row, error) {
	if id != s.row.ID || accountID != s.row.AccountID {
		return Row{}, ErrNotFound
	}
	return s.row, nil
}

func (s storedRepo) Report(context.Context, uuid.UUID) (json.RawMessage, bool, error) {
	return json.RawMessage(`{"teams":12}`), true, nil
}

// H1 (fix round 1): a pass that lapses loses the call and the report at
// once, with the 403 that names the feature; restored, the report reads.
func TestLapsedPassLosesTheCompanion(t *testing.T) {
	account := auth.Account{ID: uuid.New()}
	row := Row{ID: uuid.New(), AccountID: account.ID}
	can := &checker{}
	s := &Service{Store: storedRepo{row: row}, Entitlements: can, Now: time.Now, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	send := func(handler http.HandlerFunc, path string) (int, string) {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.SetPathValue("id", row.ID.String())
		req = req.WithContext(auth.WithAccount(req.Context(), account))
		rec := httptest.NewRecorder()
		handler(rec, req)
		var body struct {
			Error *struct {
				Feature *string `json:"feature"`
			} `json:"error"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		feature := ""
		if body.Error != nil && body.Error.Feature != nil {
			feature = *body.Error.Feature
		}
		return rec.Code, feature
	}
	can.live = false
	for name, handler := range map[string]http.HandlerFunc{"read": s.get, "report": s.report} {
		code, feature := send(handler, "/companions/"+row.ID.String())
		if code != http.StatusForbidden || feature != string(entitlements.LiveDraftAdvisor) {
			t.Fatalf("lapsed %s: %d %q, want 403 live_draft_advisor", name, code, feature)
		}
	}
	can.live = true
	if code, _ := send(s.report, "/companions/"+row.ID.String()+"/report"); code != http.StatusOK {
		t.Fatalf("restored report: %d, want 200", code)
	}
}

// In the free season an account with no pass passes the companion's gate
// (the read and the report ask the same one) and reads the report, and the card's full reasoning and range of outcomes are
// its own: the real store answers yes without a table (it has no pool).
func TestTheFreeSeasonOpensTheCompanion(t *testing.T) {
	account := auth.Account{ID: uuid.New()}
	row := Row{ID: uuid.New(), AccountID: account.ID}
	inSeason := time.Date(2026, time.October, 22, 12, 0, 0, 0, time.UTC)
	s := &Service{
		Store: storedRepo{row: row}, Entitlements: &entitlements.Store{Free: entitlements.FreeSeason(2026)},
		Now: func() time.Time { return inSeason }, Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	req := httptest.NewRequest(http.MethodGet, "/companions/"+row.ID.String()+"/report", nil)
	req.SetPathValue("id", row.ID.String())
	req = req.WithContext(auth.WithAccount(req.Context(), account))
	rec := httptest.NewRecorder()
	if !s.allowed(rec, req) {
		t.Fatalf("free season: the companion refused with %d %s", rec.Code, rec.Body.String())
	}
	s.report(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("free season report: %d %s, want 200", rec.Code, rec.Body.String())
	}
	for _, f := range []entitlements.Feature{entitlements.FullReasoning, entitlements.RangeOfOutcomes} {
		if ok, err := s.can(context.Background(), account.ID, f); err != nil || !ok {
			t.Errorf("free season %s: %v %v, want granted", f, ok, err)
		}
	}
}

// countingHost counts the reads that reach it and fails every one when
// down.
type countingHost struct {
	down  bool
	reads int
}

func (h *countingHost) Draft(context.Context, string) (sleeper.Draft, error) {
	h.reads++
	if h.down {
		return sleeper.Draft{}, sleeper.ErrUnavailable
	}
	return sleeper.Draft{ID: "1", Teams: 12, Rounds: 15, Status: sleeper.StatusDrafting}, nil
}

func (h *countingHost) Picks(context.Context, string, int, int) ([]sleeper.Pick, error) {
	return nil, nil
}

// M1 (fix round 1): one upstream read per draft per 2 s whatever the
// viewer count, with the host up and with it down before any read ever
// succeeded.
func TestPollerHoldsTheGap(t *testing.T) {
	for _, down := range []bool{false, true} {
		host := &countingHost{down: down}
		clock := time.Date(2026, 9, 10, 20, 0, 0, 0, time.UTC)
		p := &Poller{Host: host, Now: func() time.Time { return clock }}
		const viewers = 25
		for range viewers {
			_, err := p.Read(context.Background(), "1")
			if down != (err != nil) {
				t.Fatalf("down=%v: err %v", down, err)
			}
		}
		clock = clock.Add(MinUpstreamGap - time.Millisecond)
		for range viewers {
			_, _ = p.Read(context.Background(), "1")
		}
		if host.reads != 1 {
			t.Fatalf("down=%v: %d host reads inside the gap, want 1", down, host.reads)
		}
		clock = clock.Add(time.Millisecond)
		for range viewers {
			_, _ = p.Read(context.Background(), "1")
		}
		if host.reads != 2 {
			t.Fatalf("down=%v: %d host reads after the gap, want 2", down, host.reads)
		}
	}
}

// gatedHost holds its one draft read until the gate opens, so viewers
// arrive while it is in flight.
type gatedHost struct {
	reads   atomic.Int64
	entered chan struct{}
	gate    chan struct{}
}

func (h *gatedHost) Draft(context.Context, string) (sleeper.Draft, error) {
	if h.reads.Add(1) == 1 {
		close(h.entered)
	}
	<-h.gate
	return sleeper.Draft{ID: "1", Teams: 12, Rounds: 15, Status: sleeper.StatusDrafting}, nil
}

func (h *gatedHost) Picks(context.Context, string, int, int) ([]sleeper.Pick, error) { return nil, nil }

// Viewers who arrive while a read is in flight wait for it and share it:
// one host read, every viewer the same draft.
func TestPollerSharesAnInFlightRead(t *testing.T) {
	host := &gatedHost{entered: make(chan struct{}), gate: make(chan struct{})}
	clock := time.Date(2026, 9, 10, 20, 0, 0, 0, time.UTC)
	p := &Poller{Host: host, Now: func() time.Time { return clock }}
	const viewers = 10
	var wg sync.WaitGroup
	reads := make(chan Read, viewers+1)
	read := func() {
		defer wg.Done()
		r, err := p.Read(context.Background(), "1")
		if err != nil {
			t.Error(err)
		}
		reads <- r
	}
	wg.Add(1)
	go read()
	<-host.entered
	for range viewers {
		wg.Add(1)
		go read()
	}
	time.Sleep(20 * time.Millisecond)
	close(host.gate)
	wg.Wait()
	close(reads)
	n := 0
	for r := range reads {
		n++
		if r.Draft.ID != "1" || r.Draft.Teams != 12 {
			t.Fatalf("a viewer read %+v", r.Draft)
		}
	}
	if n != viewers+1 || host.reads.Load() != 1 {
		t.Fatalf("%d viewers, %d host reads, want %d and 1", n, host.reads.Load(), viewers+1)
	}
}

// countingConditional counts the conditional cards it is asked for and
// answers one for the seat it was asked about.
type countingConditional struct {
	calls atomic.Int64
	// entered is closed by the first call to reach the gate.
	entered chan struct{}
	gate    chan struct{}
}

func (c *countingConditional) Conditional(ctx context.Context, req advisor.Request) (advisor.Card, error) {
	if c.calls.Add(1) == 1 && c.entered != nil {
		close(c.entered)
	}
	if c.gate != nil {
		<-c.gate
	}
	// An engine honours its context, as the room odds do.
	if err := ctx.Err(); err != nil {
		return advisor.Card{}, err
	}
	next := 20
	return advisor.Card{Call: req.TeamID, NextPick: &next, StillThere: map[string]float64{}}, nil
}

func followedAt(row Row, picks int) followed {
	f := followed{row: row}
	f.read.Picks = make([]sleeper.Pick, picks)
	f.built.Draft.HumanTeamID = row.HostDraftID + "-seat"
	return f
}

// The between-turns card is made once per companion, seat and pick
// count, however many viewers ask at once; a new pick or a seat changed
// by a re-follow is a new card, never the old seat's.
func TestConditionalCardIsKeptPerSeatAndPick(t *testing.T) {
	cond := &countingConditional{entered: make(chan struct{}), gate: make(chan struct{})}
	s := &Service{Conditional: cond}
	row := Row{ID: uuid.New(), HostDraftID: "1", Seat: 5, CreatedAt: time.Unix(1, 0)}

	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.conditionalFor(context.Background(), followedAt(row, 6)); err != nil {
				t.Error(err)
			}
		}()
	}
	<-cond.entered
	close(cond.gate)
	wg.Wait()
	if n := cond.calls.Load(); n != 1 {
		t.Fatalf("8 viewers at one pick made %d cards, want 1", n)
	}
	if _, err := s.conditionalFor(context.Background(), followedAt(row, 6)); err != nil || cond.calls.Load() != 1 {
		t.Fatalf("the same pick again made a card (%d, %v)", cond.calls.Load(), err)
	}
	if _, err := s.conditionalFor(context.Background(), followedAt(row, 7)); err != nil || cond.calls.Load() != 2 {
		t.Fatalf("a new pick did not make a card (%d, %v)", cond.calls.Load(), err)
	}
	moved := row
	moved.Seat = 3
	card, err := s.conditionalFor(context.Background(), followedAt(moved, 7))
	if err != nil || cond.calls.Load() != 3 {
		t.Fatalf("a changed seat reused the old seat's card (%d, %v)", cond.calls.Load(), err)
	}
	if !card.Conditional || card.ForPick != 20 {
		t.Fatalf("card %+v, want conditional for pick 20", card)
	}
}

// The viewer whose request started the card leaving does not fail the
// viewers waiting on it: each of them gets the card, made once.
func TestConditionalCardOutlivesTheFirstViewer(t *testing.T) {
	cond := &countingConditional{entered: make(chan struct{}), gate: make(chan struct{})}
	s := &Service{Conditional: cond}
	row := Row{ID: uuid.New(), HostDraftID: "1", Seat: 5, CreatedAt: time.Unix(1, 0)}
	first, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := s.conditionalFor(first, followedAt(row, 6))
		done <- err
	}()
	<-cond.entered
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.conditionalFor(context.Background(), followedAt(row, 6))
			errs <- err
		}()
	}
	time.Sleep(20 * time.Millisecond)
	cancel()
	close(cond.gate)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("a waiting viewer failed with the first viewer's cancel: %v", err)
		}
	}
	<-done
	if n := cond.calls.Load(); n != 1 {
		t.Fatalf("%d cards made, want 1", n)
	}
}

// recentRepo answers Recent for one account only, as the store's query
// does, and records whom it was asked about.
type recentRepo struct {
	Repository
	owner uuid.UUID
	asked uuid.UUID
}

func (r *recentRepo) Recent(_ context.Context, accountID uuid.UUID, limit int) ([]Row, error) {
	r.asked = accountID
	if accountID != r.owner || limit != recentShown {
		return nil, nil
	}
	return []Row{{ID: uuid.New(), AccountID: accountID, HostDraftID: "1", Seat: 4, HostUsername: "muttdog", Status: "drafting"}}, nil
}

// GET /companions answers the caller's own followed drafts and nobody
// else's, and needs the live draft advisor like every companion read.
func TestRecentIsTheCallersOwn(t *testing.T) {
	me := auth.Account{ID: uuid.New()}
	repo := &recentRepo{owner: me.ID}
	can := &checker{}
	s := &Service{Store: repo, Entitlements: can, Now: time.Now, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	send := func() (int, []apitypes.CompanionSummary) {
		req := httptest.NewRequest(http.MethodGet, "/companions", nil)
		req = req.WithContext(auth.WithAccount(req.Context(), me))
		rec := httptest.NewRecorder()
		s.recent(rec, req)
		var body struct {
			Data []apitypes.CompanionSummary `json:"data"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		return rec.Code, body.Data
	}
	if code, _ := send(); code != http.StatusForbidden {
		t.Fatalf("without the pass: %d, want 403", code)
	}
	can.live = true
	code, rows := send()
	if code != http.StatusOK || repo.asked != me.ID {
		t.Fatalf("with the pass: %d, asked about %s, want 200 about %s", code, repo.asked, me.ID)
	}
	if len(rows) != 1 || rows[0].HostUsername == nil || *rows[0].HostUsername != "muttdog" || rows[0].Slot != 4 {
		t.Fatalf("rows %+v", rows)
	}
}

// directory answers a league's members, or fails.
type directory struct {
	users []sleeper.User
	err   error
}

func (d directory) UserID(context.Context, string) (string, error) { return "", sleeper.ErrNotFound }
func (d directory) League(context.Context, string) (sleeper.League, error) {
	return sleeper.League{}, sleeper.ErrNotFound
}
func (d directory) LeagueUsers(context.Context, string) ([]sleeper.User, error) {
	return d.users, d.err
}

// Each slot's name comes from the league's members by the draft order: a
// mock draft (no league) and a failed read get none, and a slot no
// member holds is empty.
func TestSeatNames(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	draft := sleeper.Draft{LeagueID: "9", Teams: 3, Order: map[string]int{"11": 1, "33": 3}}
	users := []sleeper.User{{ID: "11", DisplayName: "muttdog"}, {ID: "33", DisplayName: "Nowlan"}}

	s := &Service{Directory: directory{users: users}, Log: log}
	got := s.seatNames(context.Background(), draft)
	if len(got) != 3 || got[0] != "muttdog" || got[1] != "" || got[2] != "Nowlan" {
		t.Fatalf("names %q, want muttdog, empty, Nowlan", got)
	}
	mockDraft := draft
	mockDraft.LeagueID = ""
	if got := s.seatNames(context.Background(), mockDraft); got != nil {
		t.Fatalf("a mock draft named %q", got)
	}
	failing := &Service{Directory: directory{err: errors.New("down")}, Log: log}
	if got := failing.seatNames(context.Background(), draft); got != nil {
		t.Fatalf("a failed read named %q", got)
	}
}

// The store keeps each account's companions apart: Recent answers only
// the caller's, newest first, at most the limit, and a re-follow keeps
// or clears the saved username and the seat names with the seat.
func TestStoreRecentAndSeatPeople(t *testing.T) {
	pool := dbtest.Pool(t)
	ctx := context.Background()
	accounts := &auth.Store{Pool: pool}
	mine, err := accounts.UpsertAccount(ctx, auth.Identity{UserID: "user_mine", Email: "mine@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	theirs, err := accounts.UpsertAccount(ctx, auth.Identity{UserID: "user_theirs", Email: "theirs@example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	store := &Store{Pool: pool}
	follow := func(account uuid.UUID, draftID, username string, names []string) Row {
		r, err := store.Upsert(ctx, Row{AccountID: account, Host: "sleeper", HostDraftID: draftID, Seat: 4,
			HostUsername: username, SeatNames: names, DraftName: "League " + draftID, Settings: apitypes.LeagueSettings{}, Status: "drafting"})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	for i := range 7 {
		follow(mine.ID, fmt.Sprint(100+i), "", nil)
	}
	follow(theirs.ID, "999", "someone", nil)
	newest := follow(mine.ID, "555", "muttdog", []string{"muttdog", "", "Nowlan"})

	rows, err := store.Recent(ctx, mine.ID, recentShown)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != recentShown || rows[0].ID != newest.ID {
		t.Fatalf("recent: %d rows, newest %s, want %d with %s first", len(rows), rows[0].ID, recentShown, newest.ID)
	}
	for _, r := range rows {
		if r.AccountID != mine.ID {
			t.Fatalf("recent answered another account's companion %s", r.ID)
		}
	}
	if rows[0].DraftName != "League 555" || rows[0].HostUsername != "muttdog" || len(rows[0].SeatNames) != 3 || rows[0].SeatNames[2] != "Nowlan" {
		t.Fatalf("saved username %q names %q", rows[0].HostUsername, rows[0].SeatNames)
	}
	again := follow(mine.ID, "555", "", nil)
	if again.ID != newest.ID || again.HostUsername != "" || len(again.SeatNames) != 0 {
		t.Fatalf("a re-follow by slot kept username %q names %q", again.HostUsername, again.SeatNames)
	}
	if _, err := store.Upsert(ctx, Row{AccountID: mine.ID, Host: "sleeper", HostDraftID: "556", Seat: 1,
		HostUsername: "not a username!", Settings: apitypes.LeagueSettings{}, Status: "drafting"}); err == nil {
		t.Fatal("the column took a username Sleeper would refuse")
	}
}

// scriptedIDs answers its reads in order, failing on a nil entry.
type scriptedIDs struct {
	answers []map[string]string
	reads   int
}

func (s *scriptedIDs) SleeperIDs(context.Context) (map[string]string, error) {
	i := min(s.reads, len(s.answers)-1)
	s.reads++
	if s.answers[i] == nil {
		return nil, errors.New("pool blip")
	}
	return s.answers[i], nil
}

// A failed id read is never kept as fresh: the next poll after a short
// retry reads again, a failure with a map in hand keeps that map, and a
// pick whose id the map lacks is placed by exact name, position and team.
func TestIDMatcherSurvivesAFailedRead(t *testing.T) {
	raw := &boards.Raw{Players: []boards.Player{
		{ID: "p1", Name: "Jaxon Smith-Njigba", Position: draft.WR, Team: "SEA"},
		{ID: "p2", Name: "Mike Washington Jr.", Position: draft.RB, Team: "LV"},
	}}
	jsn := sleeper.Pick{PlayerID: "9488", Name: "Jaxon Smith-Njigba", Position: "WR", Team: "SEA"}
	rookie := sleeper.Pick{PlayerID: "13305", Name: "Mike Washington", Position: "RB", Team: "LV"}
	ids := &scriptedIDs{answers: []map[string]string{nil, {}, {"9488": "p1"}, nil}}
	clock := time.Date(2026, 9, 10, 20, 0, 0, 0, time.UTC)
	m := &IDMatcher{IDs: ids, Teams: &NameMatcher{}, TTL: time.Hour, Now: func() time.Time { return clock },
		Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if _, how, ok := m.Match(raw, jsn); !ok || how != MatchSleeperName {
		t.Fatalf("with no map read a pick is placed by name, not by id: %q %v", how, ok)
	}
	if id, how, ok := m.Match(raw, rookie); !ok || id != "p2" || how != MatchSleeperName {
		t.Fatalf("the rookie by name: %q %q %v", id, how, ok)
	}
	if ids.reads != 1 {
		t.Fatalf("%d reads inside the retry, want 1", ids.reads)
	}
	clock = clock.Add(defaultIDRetry)
	m.Match(raw, jsn)
	if ids.reads != 2 {
		t.Fatalf("%d reads after the retry, want 2 (an empty map is a failure too)", ids.reads)
	}
	clock = clock.Add(defaultIDRetry)
	if id, how, ok := m.Match(raw, jsn); !ok || id != "p1" || how != MatchSleeperID {
		t.Fatalf("by id after a good read: %q %q %v", id, how, ok)
	}
	clock = clock.Add(2 * time.Hour)
	m.refresh()
	if id, _, ok := m.Match(raw, jsn); !ok || id != "p1" {
		t.Fatal("a failed refresh dropped the map in hand")
	}
}

// A host that drops his accent still places him on a board that keeps it
// (Lane 78): the folded name, the prefix and the Sleeper name fallback.
func TestAnUnaccentedPickPlacesTheAccentedPlayer(t *testing.T) {
	if FoldName("Audric Estimé") != FoldName("Audric Estime") {
		t.Fatalf("FoldName keeps the accent: %q, %q", FoldName("Audric Estimé"), FoldName("Audric Estime"))
	}
	raw := &boards.Raw{Players: []boards.Player{{ID: "4569682", Name: "Audric Estimé", Position: draft.RB, Team: "DEN"}}}
	pick := sleeper.Pick{PlayerID: "11597", Name: "Audric Estime", Position: "RB", Team: "DEN"}
	if id, how, ok := (&NameMatcher{}).Match(raw, pick); !ok || id != "4569682" || how != MatchNormalized {
		t.Fatalf("by name: %q %q %v", id, how, ok)
	}
	cut := sleeper.Pick{Name: "Audric Est", Position: "RB", Team: "DEN"}
	if id, how, ok := (&NameMatcher{}).Match(raw, cut); !ok || id != "4569682" || how != MatchPrefix {
		t.Fatalf("by prefix: %q %q %v", id, how, ok)
	}
	m := &IDMatcher{IDs: &scriptedIDs{answers: []map[string]string{{"1": "x"}}}, Teams: &NameMatcher{}, TTL: time.Hour,
		Now: func() time.Time { return time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC) },
		Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if id, how, ok := m.Match(raw, pick); !ok || id != "4569682" || how != MatchSleeperName {
		t.Fatalf("by the Sleeper name fallback: %q %q %v", id, how, ok)
	}
}
