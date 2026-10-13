package companion

import (
	"net/http"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// recentShown is how many followed drafts the start page lists.
const recentShown = 5

// recent is the account's newest followed drafts: the start page offers
// the way back to each and the Sleeper username last used.
func (s *Service) recent(w http.ResponseWriter, r *http.Request) {
	if !s.allowed(w, r) {
		return
	}
	rows, err := s.Store.Recent(r.Context(), auth.AccountID(r), recentShown)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "companion: recent", err)
		return
	}
	out := make([]apitypes.CompanionSummary, 0, len(rows))
	for _, row := range rows {
		v := apitypes.CompanionSummary{
			Id: row.ID, HostDraftId: row.HostDraftID, Slot: row.Seat, Replay: row.Replay,
			Status: apitypes.CompanionStatus(row.Status), CreatedAt: row.CreatedAt,
		}
		if row.HostUsername != "" {
			name := row.HostUsername
			v.HostUsername = &name
		}
		out = append(out, v)
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}
