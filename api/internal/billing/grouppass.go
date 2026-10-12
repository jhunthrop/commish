package billing

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// claimCodeBytes is the claim link's entropy: 128 bits, unguessable,
// 22 characters in the link.
const claimCodeBytes = 16

func newClaimCode() string {
	b := make([]byte, claimCodeBytes)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func (s *Service) claimURL(code string) string { return s.site(pathClaim + code) }

func (s *Service) listGroupPasses(w http.ResponseWriter, r *http.Request) {
	passes, err := s.Store.GroupPassesBoughtBy(r.Context(), auth.AccountID(r))
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "billing: group passes", err)
		return
	}
	out := make([]apitypes.GroupPass, 0, len(passes))
	for _, g := range passes {
		out = append(out, apitypes.GroupPass{
			Id: g.ID, LeagueName: g.LeagueName, Season: g.Season, Seats: g.Seats, Claimed: g.Claimed,
			ClaimUrl: s.claimURL(g.ClaimCode), CreatedAt: g.CreatedAt,
		})
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// groupPassByCode reads the pass a link names, answering 404 for a
// code that names none or a pass that was refunded.
func (s *Service) groupPassByCode(w http.ResponseWriter, r *http.Request) (GroupPass, bool) {
	g, err := s.Store.GroupPassByCode(r.Context(), r.PathValue("code"))
	if errors.Is(err, ErrNoGroupPass) || (err == nil && g.Status != entitlements.StatusActive) {
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, "This link does not open a pass", nil)
		return GroupPass{}, false
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "billing: group pass", err)
		return GroupPass{}, false
	}
	return g, true
}

func (s *Service) previewGroupPass(w http.ResponseWriter, r *http.Request) {
	g, ok := s.groupPassByCode(w, r)
	if !ok {
		return
	}
	handle, err := s.Handles.HandleOf(r.Context(), g.PurchaserID)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "billing: group pass purchaser", err)
		return
	}
	mine := false
	if a, signed := auth.AccountFrom(r.Context()); signed {
		if mine, err = s.Store.ClaimedBy(r.Context(), g.ID, a.ID); err != nil {
			httpx.WriteInternal(w, r, s.Log, "billing: group pass claimed", err)
			return
		}
	}
	httpx.WriteOK(w, r, http.StatusOK, apitypes.GroupPassPreview{
		LeagueName: g.LeagueName, Season: g.Season, Seats: g.Seats, Claimed: g.Claimed,
		PurchaserHandle: handle, ClaimedByMe: mine,
	})
}

func (s *Service) claimGroupPass(w http.ResponseWriter, r *http.Request) {
	g, ok := s.groupPassByCode(w, r)
	if !ok {
		return
	}
	accountID := auth.AccountID(r)
	err := s.Entitlements.ClaimGroupPass(r.Context(), g.ID, accountID, "claim:"+accountID.String())
	switch {
	case errors.Is(err, entitlements.ErrAlreadyClaimed):
		// Claiming twice is not a mistake worth an error: the pass is
		// already theirs.
	case errors.Is(err, entitlements.ErrGroupPassFull):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "Every pass on this link is taken", nil)
		return
	case errors.Is(err, entitlements.ErrNoGroupPass), errors.Is(err, entitlements.ErrGroupPassClosed):
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, "This link does not open a pass", nil)
		return
	case err != nil:
		httpx.WriteInternal(w, r, s.Log, "billing: claim", err)
		return
	}
	s.writeAccount(w, r)
}
