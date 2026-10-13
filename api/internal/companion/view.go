package companion

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// maxSince bounds the since query: no draft has more picks.
const maxSince = 1600

func (s *Service) get(w http.ResponseWriter, r *http.Request) {
	row, ok := s.load(w, r)
	if !ok {
		return
	}
	since := 0
	if v := r.URL.Query().Get("since"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 || n > maxSince {
			httpx.WriteInvalid(w, r, map[string]string{"since": "Give the pick count you already have"})
			return
		}
		since = n
	}
	s.answer(w, r, row, since)
}

// followed is a companion read against the host: the host's draft, the
// board and our engine's replay of it.
type followed struct {
	row   Row
	read  Read
	board boards.Board
	built Built
}

// follow reads the host (or the recording) and replays its picks.
func (s *Service) follow(ctx context.Context, row Row) (followed, error) {
	var read Read
	if row.Replay {
		read = Read{Snapshot: s.Replay.At(s.Now().Sub(row.CreatedAt), row.Seat)}
	} else {
		var err error
		if read, err = s.Poller.Read(ctx, row.HostDraftID); err != nil {
			return followed{}, err
		}
	}
	board, err := s.Boards.For(ctx, row.Settings)
	if err != nil {
		return followed{}, err
	}
	settings := mock.Settings{League: row.Settings, Pool: board.Pool()}
	built, err := Build(settings, board.Raw, row.Seat, read.Picks, s.Matcher)
	if err != nil {
		return followed{}, err
	}
	return followed{row: row, read: read, board: board, built: built}, nil
}

func (s *Service) answer(w http.ResponseWriter, r *http.Request, row Row, since int) {
	ctx := r.Context()
	f, err := s.follow(ctx, row)
	if err != nil {
		s.writeHostError(w, r, err)
		return
	}
	status := f.read.Draft.Status
	if err := s.Store.Progress(ctx, row.ID, status, len(f.read.Picks), status == sleeper.StatusComplete); err != nil {
		httpx.WriteInternal(w, r, s.Log, "companion: progress", err)
		return
	}
	out := s.view(f, since)
	if out.YourTurn && f.built.LostAt == nil {
		card, ranges, err := s.cardFor(ctx, f)
		if err != nil {
			httpx.WriteInternal(w, r, s.Log, "companion: card", err)
			return
		}
		out.Card, out.Ranges = card, ranges
	}
	if since == 0 {
		board := draftroom.BoardView(f.board, nil)
		out.Board = &board
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// view is everything but the card and the board.
func (s *Service) view(f followed, since int) apitypes.Companion {
	d, st := f.read.Draft, f.built.Draft.State
	total := draft.TotalPickCount(st)
	out := apitypes.Companion{
		Id: f.row.ID, Host: apitypes.CompanionHost(f.row.Host), HostDraftId: f.row.HostDraftID, Replay: f.row.Replay,
		Name: d.Name, Status: apitypes.CompanionStatus(d.Status), Teams: d.Teams, Rounds: d.Rounds, Slot: f.row.Seat,
		Settings: f.row.Settings, Basis: basisWords(f.board), PickCount: len(f.read.Picks), TotalPicks: total,
		Since: min(since, len(f.read.Picks)), Unplaced: f.built.Unplaced, LostAt: f.built.LostAt,
		Traded: traded(d, f.read.Picks), CreatedAt: f.row.CreatedAt, Picks: []apitypes.CompanionPick{},
	}
	if f.read.Stale > 0 {
		secs := int(f.read.Stale / time.Second)
		out.HostStaleSeconds = &secs
	}
	drafting := d.Status == sleeper.StatusDrafting || d.Status == sleeper.StatusPaused
	if team, ok := draft.TeamOnClock(st); ok && drafting && f.built.LostAt == nil {
		slot := draftroom.SeatNumber(st.DraftOrder, team)
		out.OnClock = &slot
		out.YourTurn = slot == f.row.Seat
	}
	if next, ok := nextPickFor(st.DraftOrder, mock.SeatID(f.row.Seat), len(f.read.Picks)+1, total); ok && d.Status != sleeper.StatusComplete {
		until := next - len(f.read.Picks) - 1
		out.YourNextPick, out.PicksUntilTurn = &next, &until
	}
	placed := map[int]string{}
	for _, p := range f.built.Placed {
		placed[p.Pick.PickNo] = p.PlayerID
	}
	for _, p := range f.read.Picks {
		if p.PickNo <= out.Since {
			continue
		}
		v := apitypes.CompanionPick{
			Pick: p.PickNo, Round: p.Round, Seat: p.Slot, HostPlayerId: p.PlayerID, Name: p.Name,
			Position: p.Position, Team: p.Team, Keeper: p.Keeper,
		}
		if id := placed[p.PickNo]; id != "" {
			v.PlayerId = &id
		}
		out.Picks = append(out.Picks, v)
	}
	return out
}

// nextPickFor is the seat's first pick at or after from.
func nextPickFor(order []string, team string, from, total int) (int, bool) {
	for n := from; n <= total; n++ {
		if t, err := draft.SnakeTeamForPick(order, n); err == nil && t == team {
			return n, true
		}
	}
	return 0, false
}

// traded counts picks made by a roster other than the slot's own.
func traded(d sleeper.Draft, picks []sleeper.Pick) int {
	n := 0
	for _, p := range picks {
		if own, ok := d.SlotRoster[p.Slot]; ok && p.RosterID != 0 && p.RosterID != own {
			n++
		}
	}
	return n
}

// basisWords names the board our call reads.
func basisWords(b boards.Board) string {
	return "Our " + b.Raw.Format.Words() + " board, the nearest of ours to your league's scoring, valued for its roster."
}
