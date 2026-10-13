package leaguesync

import (
	"net/http"
	"sync"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// Pushed pages: a paired device (the extension, later) sends the league
// pages the member's own browser holds, as raw HTML, and the same parsers
// the server's own read uses read them. Nothing new is parsed here.
const (
	maxPushBody      = 8 << 20
	limitPushPerMin  = 30
	pushPageInterval = 10 * time.Second
)

// pushGate holds one batch a page per device per league per ten seconds.
type pushGate struct {
	mu   sync.Mutex
	last map[string]time.Time
}

func (g *pushGate) allow(key string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.last == nil {
		g.last = map[string]time.Time{}
	}
	if at, ok := g.last[key]; ok && now.Sub(at) < pushPageInterval {
		return false
	}
	g.last[key] = now
	for k, at := range g.last {
		if now.Sub(at) > time.Hour {
			delete(g.last, k)
		}
	}
	return true
}

// pushRoute is the device route for pushed pages.
func (s *Service) pushRoute() httpx.Route {
	return httpx.Route{Method: http.MethodPost, Path: "/leagues/attached/{id}/pages", Access: httpx.Device,
		Scope: string(auth.ScopeLeagueWrite), Limit: httpx.PerMinute(limitPushPerMin), Handler: s.pushPages}
}

func (s *Service) pushPages(w http.ResponseWriter, r *http.Request) {
	link, ok := s.load(w, r)
	if !ok {
		return
	}
	var in apitypes.LeaguePages
	if !httpx.DecodeJSON(w, r, maxPushBody, &in) {
		return
	}
	if link.Ref.Host != HostFFPC || len(in.Pages) == 0 || len(in.Pages) > 7 {
		httpx.WriteInvalid(w, r, map[string]string{"pages": "Send an FFPC league's pages, its league home first"})
		return
	}
	dev, _ := auth.DeviceFrom(r.Context())
	now := s.Now()
	pages := map[ffpc.PageName][]byte{}
	refused := map[string]string{}
	for _, p := range in.Pages {
		name := ffpc.PageName(p.Page)
		switch {
		case !p.Page.Valid() || !ffpc.ValidPage(name):
			refused[string(p.Page)] = "Not a page we read"
		case !s.pushes.allow(dev.ID.String()+"|"+link.ID.String()+"|"+string(p.Page), now):
			refused[string(p.Page)] = "Sent less than ten seconds ago"
		default:
			pages[name] = []byte(p.Html)
		}
	}
	if _, ok := pages[ffpc.PageLeagueHome]; !ok {
		httpx.WriteError(w, r, http.StatusTooManyRequests, httpx.CodeRateLimited, "Send the league home page with the others, ten seconds apart", nil)
		return
	}
	l, err := ffpc.Parse(pages, nil)
	if err != nil || l.Banner.LeagueID != link.Ref.LeagueID || l.Banner.TeamID != link.RosterID {
		httpx.WriteInvalid(w, r, map[string]string{"pages": "These pages are not your team in this league"})
		return
	}
	prev, _, err := s.Poller.Store.LastSnapshot(r.Context(), link.Ref)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: pushed snapshot", err)
		return
	}
	snap := overlay(prev, ffpcSnapshot(l, now), pages, l)
	if err := s.Poller.Store.PutSnapshot(r.Context(), snap); err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: keep pushed", err)
		return
	}
	taken := make([]apitypes.HostPage, 0, len(pages))
	for name := range pages {
		taken = append(taken, apitypes.HostPage(name))
	}
	httpx.WriteOK(w, r, http.StatusOK, apitypes.PagesTaken{Taken: taken, Refused: refused, ReadAt: now})
}

// overlay is the pushed read laid over the last one: what the pushed
// pages did not carry is kept from before.
func overlay(prev, next Snapshot, pages map[ffpc.PageName][]byte, l ffpc.League) Snapshot {
	out := next
	_, standings := pages[ffpc.PageStandings]
	_, rosters := pages[ffpc.PageRosters]
	if !standings && !rosters && len(prev.Teams) > 0 {
		out.Teams = prev.Teams
	}
	if l.Rules == nil || len(l.Rules.Scoring) == 0 {
		out.Scoring, out.Shape = prev.Scoring, prev.Shape
	}
	if _, ok := pages[ffpc.PageSchedule]; !ok {
		out.Matchups = prev.Matchups
	}
	for id, p := range prev.Players {
		if _, ok := out.Players[id]; !ok {
			out.Players[id] = p
		}
	}
	return out
}
