package devices

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/notify"
)

// limitPushPerMinute bounds an app's push registrations: one at launch
// and one when the platform rotates its token.
const limitPushPerMinute = 30

// pushToken is the shape a platform's token takes: an APNs token in hex,
// an FCM registration token, between the two lengths. The same as
// app.devices' check.
var pushToken = regexp.MustCompile(`^[A-Za-z0-9_:.-]+$`)

const (
	minPushToken = 16
	maxPushToken = 4096
)

// The registration refusals, by field.
const (
	badPlatform  = "Register as apns or fcm"
	badPushToken = "Send the platform's token for this install as it gave it"
)

// PushRepository is the part of Store the push routes use.
type PushRepository interface {
	PutPush(ctx context.Context, accountID, id uuid.UUID, platform, token string, now time.Time) (time.Time, error)
	DeletePush(ctx context.Context, accountID, id uuid.UUID) error
}

// pushRoutes are an app's own push registration (spec §5.3): the device
// routes with the session scope, so only an app's token reaches them.
func (s *Service) pushRoutes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodPut, Path: "/devices/{id}/push", Access: httpx.Device, Scope: string(auth.ScopeSession),
			Limit: httpx.PerMinute(limitPushPerMinute), Handler: s.putPush},
		{Method: http.MethodDelete, Path: "/devices/{id}/push", Access: httpx.Device, Scope: string(auth.ScopeSession),
			Limit: httpx.PerMinute(limitPushPerMinute), Handler: s.deletePush},
	}
}

// ownDevice is the path's device when it is the device asking, else a
// 404: an app registers only itself.
func ownDevice(w http.ResponseWriter, r *http.Request) (auth.Device, bool) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return auth.Device{}, false
	}
	dev, ok := auth.DeviceFrom(r.Context())
	if !ok || dev.ID != id {
		httpx.WriteNotFound(w, r)
		return auth.Device{}, false
	}
	return dev, true
}

// pushFaults is the registration's faults by field, nil when it reads.
func pushFaults(in apitypes.PushRegistration) map[string]string {
	faults := map[string]string{}
	if _, ok := notify.ParsePlatform(string(in.Platform)); !ok {
		faults["platform"] = badPlatform
	}
	if len(in.Token) < minPushToken || len(in.Token) > maxPushToken || !pushToken.MatchString(in.Token) {
		faults["token"] = badPushToken
	}
	if len(faults) == 0 {
		return nil
	}
	return faults
}

func (s *Service) putPush(w http.ResponseWriter, r *http.Request) {
	dev, ok := ownDevice(w, r)
	if !ok {
		return
	}
	var in apitypes.PushRegistration
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	if faults := pushFaults(in); faults != nil {
		httpx.WriteInvalid(w, r, faults)
		return
	}
	at, err := s.Push.PutPush(r.Context(), dev.AccountID, dev.ID, string(in.Platform), in.Token, s.Now())
	if errors.Is(err, ErrNotFound) {
		httpx.WriteNotFound(w, r)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "devices: put push", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, apitypes.PushRegistered{Platform: in.Platform, RegisteredAt: at})
}

func (s *Service) deletePush(w http.ResponseWriter, r *http.Request) {
	dev, ok := ownDevice(w, r)
	if !ok {
		return
	}
	err := s.Push.DeletePush(r.Context(), dev.AccountID, dev.ID)
	if errors.Is(err, ErrNotFound) {
		httpx.WriteNotFound(w, r)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "devices: delete push", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, nil)
}
