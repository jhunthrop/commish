package companion

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/poll"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// HostFFPC is FFPC: its draft board read as the member, through their
// connection, on the companion's two-second cadence (founder ruling
// 2026-10-13).
const HostFFPC = ffpc.Host

var errFFPCNotSetUp = errors.New("companion: ffpc not set up")

// FFPCMember reads FFPC as a member. *ffpc.Member implements it.
type FFPCMember interface {
	ReadDraft(ctx context.Context, accountID uuid.UUID, ltuid string) (ffpc.Draft, error)
	ReadLeague(ctx context.Context, accountID uuid.UUID, ltuid string, rules bool) (ffpc.League, error)
	OpenLeague(ctx context.Context, accountID uuid.UUID, leagueID string) (string, error)
}

// FFPCDrafts shares one read of an FFPC draft board per two seconds
// between its viewers, read as the companion's own member.
type FFPCDrafts struct {
	Member FFPCMember
	Now    func() time.Time

	once  sync.Once
	inner *poll.Poller[Snapshot]
}

func (f *FFPCDrafts) shared() *poll.Poller[Snapshot] {
	f.once.Do(func() {
		f.inner = &poll.Poller[Snapshot]{
			Now: f.Now, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), Idle: idleAfter, Timeout: ffpcReadTimeout,
			Outlive: true,
		}
	})
	return f.inner
}

// ffpcReadTimeout bounds one board read: a page, waiting its turn behind
// the process's one-a-second gap.
const ffpcReadTimeout = 20 * time.Second

// FFPCGap is an FFPC board's read cadence: one read per draft per five
// seconds whatever the number of members following it, kinder to FFPC's
// one-request-a-second pace than Sleeper's two.
const FFPCGap = 5 * time.Second

// Read is the draft as of at most FFPCGap ago: one read per league,
// shared by every member following it, read as whichever member asked
// first. The board's own marks (whose picks are whose) are the reader's,
// so a member's seat comes from their companion row, never from a read.
func (f *FFPCDrafts) Read(ctx context.Context, accountID uuid.UUID, leagueID, ltuid string) (Read, error) {
	r, err := f.shared().Read(ctx, HostFFPC+"/"+leagueID, FFPCGap, poll.Wait, func(ctx context.Context) (Snapshot, error) {
		d, err := f.Member.ReadDraft(ctx, accountID, ltuid)
		if err != nil {
			return Snapshot{}, err
		}
		return ffpcSnapshot(leagueID, d), nil
	})
	if err != nil {
		return Read{}, err
	}
	snap := r.Value
	snap.FetchedAt = r.At
	return Read{Snapshot: snap, Stale: r.Stale}, nil
}

// ffpcSnapshot is the board as the Sleeper-shaped draft the engine
// replay takes: a snake of the board's teams and rounds, each pick at
// its slot, a pick FFPC gives no id for keyed by its number.
func ffpcSnapshot(leagueID string, d ffpc.Draft) Snapshot {
	status := sleeper.StatusPreDraft
	switch {
	case d.Complete:
		status = sleeper.StatusComplete
	case len(d.Picks) > 0:
		status = sleeper.StatusDrafting
	}
	out := Snapshot{Draft: sleeper.Draft{
		ID: leagueID, Type: sleeper.TypeSnake, Status: status, Teams: d.Teams, Rounds: d.Rounds,
		Slots: map[string]int{}, Order: map[string]int{}, SlotRoster: map[int]int{},
	}}
	for _, p := range d.Picks {
		id := p.Player.ID
		if id == "" {
			id = fmt.Sprintf("pick%d", p.Number)
		}
		out.Picks = append(out.Picks, sleeper.Pick{
			PickNo: p.Number, Round: p.Round, Slot: p.Slot, PlayerID: id,
			Name: p.Player.Name, Position: p.Player.Position, Team: p.Player.Team,
		})
	}
	return out
}

// slotsOf is an FFPC league's lineup as the draft's slots_* settings.
func slotsOf(r *ffpc.Rules, rounds int) map[string]int {
	if r == nil {
		return map[string]int{}
	}
	l := r.Lineup
	out := map[string]int{
		slotQB: l.QB, slotRB: l.RB, slotWR: l.WR, slotTE: l.TE, slotK: l.K, slotDEF: l.DEF,
		slotFlex: l.Flex, slotSuperFlex: l.SuperFlex,
	}
	if bench := rounds - l.Starters(); bench > 0 {
		out[slotBench] = bench
	}
	for _, o := range l.Other {
		out["slots_"+strings.ToLower(strings.NewReplacer("-", "", " ", "", "/", "").Replace(o))] = 1
	}
	return out
}

// createFFPC follows one of the member's FFPC drafts: the league from
// their list opens their own team, the board and the rules are read as
// them, and the seat is the slot the board marks as theirs (or the one
// they chose, before their first pick).
func (s *Service) createFFPC(w http.ResponseWriter, r *http.Request, in apitypes.CompanionCreate) {
	if s.FFPC == nil {
		s.writeHostError(w, r, errFFPCNotSetUp)
		return
	}
	leagueID := strings.TrimSpace(in.Draft)
	if !ffpcLeague(leagueID) {
		httpx.WriteInvalid(w, r, map[string]string{fieldDraft: "Pick your league from your FFPC list"})
		return
	}
	ctx := r.Context()
	accountID := auth.AccountID(r)
	ltuid, err := s.FFPC.Member.OpenLeague(ctx, accountID, leagueID)
	if err != nil {
		s.writeHostError(w, r, err)
		return
	}
	// The seat is read once, as the member, from their own view of the
	// board; the shared reads that follow never decide it.
	board, err := s.FFPC.Member.ReadDraft(ctx, accountID, ltuid)
	if err != nil {
		s.writeHostError(w, r, err)
		return
	}
	read := Read{Snapshot: ffpcSnapshot(leagueID, board)}
	league, err := s.FFPC.Member.ReadLeague(ctx, accountID, ltuid, true)
	if err != nil {
		s.writeHostError(w, r, err)
		return
	}
	seat := board.MySlot
	if seat == 0 && in.Seat.Slot != nil {
		seat = *in.Seat.Slot
	}
	if seat < 1 || seat > read.Draft.Teams {
		httpx.WriteInvalid(w, r, map[string]string{fieldSeat: fmt.Sprintf("Pick your draft slot, 1 to %d", read.Draft.Teams)})
		return
	}
	d := read.Draft
	d.Slots, d.Name = slotsOf(league.Rules, d.Rounds), league.Banner.LeagueName
	var scoring *sleeper.League
	if league.Rules != nil && len(league.Rules.Scoring) > 0 {
		scoring = &sleeper.League{ID: leagueID, Scoring: league.Rules.Scoring}
	}
	settings, err := SettingsFor(d, scoring, seat)
	if err != nil {
		s.writeHostError(w, r, err)
		return
	}
	row, err := s.Store.Upsert(ctx, Row{
		AccountID: accountID, Host: HostFFPC, HostDraftID: leagueID, HostLeagueID: leagueID, Seat: seat,
		Settings: settings, Status: d.Status, SeatNames: board.SlotNames, DraftName: cleanName(d.Name), TeamKey: ltuid,
	})
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "companion: create ffpc", err)
		return
	}
	s.answer(w, r, row, 0)
}

func ffpcLeague(id string) bool {
	if id == "" || len(id) > 12 {
		return false
	}
	for _, c := range id {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func cleanName(s string) string { return ffpc.Clean(s, 80) }

// writeFFPCError answers a member read's errors, and reports whether it did.
func writeFFPCError(w http.ResponseWriter, r *http.Request, log *slog.Logger, err error) bool {
	switch {
	case errors.Is(err, errFFPCNotSetUp):
		httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable, "FFPC drafts are not set up here", nil)
	case errors.Is(err, hosts.ErrNotConnected):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "Connect FFPC first, on Follow your draft", nil)
	case errors.Is(err, ffpc.ErrNeedsSignIn):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "FFPC signed you out. Sign in to FFPC again on Follow your draft", nil)
	case errors.Is(err, ffpc.ErrNoSuchLeague):
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, "That league is not in your FFPC list", nil)
	case errors.Is(err, ffpc.ErrNotThisPage):
		log.Warn("companion: ffpc page", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "FFPC answered with a page we do not read. Its draft board may not be up yet", nil)
	case errors.Is(err, ffpc.ErrUnavailable), errors.Is(err, ffpc.ErrBusy), errors.Is(err, ffpc.ErrSignedOut):
		log.Warn("companion: ffpc", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, "FFPC is not answering right now. Try again in a moment", nil)
	default:
		return false
	}
	return true
}
