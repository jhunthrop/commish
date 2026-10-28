package notify

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// Settings is the account's push settings as /me reads and writes them:
// account.Viewer's Notifications and auth.Handler's Notifications.
type Settings struct{ Store *Store }

// Notifications is the account's settings on the wire, the defaults until
// it changes one.
func (s *Settings) Notifications(ctx context.Context, accountID uuid.UUID) (apitypes.NotificationSettings, error) {
	p, err := s.Store.Preferences(ctx, accountID)
	if err != nil {
		return apitypes.NotificationSettings{}, err
	}
	return p.Wire(), nil
}

// CheckNotifications is the update's faults by field, nil when every
// field it sends reads: checked before anything on the account is
// written, so a PATCH that also sets a handle changes nothing on a fault.
func (s *Settings) CheckNotifications(u apitypes.NotificationSettingsUpdate) map[string]string {
	_, faults := Apply(DefaultPreferences(), u)
	return faults
}

// UpdateNotificationsIn applies a checked update to the account's
// settings inside the caller's transaction (PATCH /me's, with the
// handle), the row locked from read to write.
func (s *Settings) UpdateNotificationsIn(ctx context.Context, tx pgx.Tx, accountID uuid.UUID, u apitypes.NotificationSettingsUpdate) error {
	return UpdatePreferences(ctx, tx, accountID, func(p Preferences) (Preferences, map[string]string) { return Apply(p, u) })
}

// FaultError is an update that did not read, by field.
type FaultError struct{ Faults map[string]string }

func (e *FaultError) Error() string { return "notify: the settings did not read" }
