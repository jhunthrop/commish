package hosts

import (
	"context"
	"fmt"
	"time"
)

// attemptsKept is how long a sign-in attempt row is kept: the caps look
// back an hour.
const attemptsKept = 24 * time.Hour

// LoginAttempt keeps one sign-in our form is about to send to the host,
// before it is sent, under a keyed hash of the username (never the
// username), and trims the host's rows older than a day.
func (s *Store) LoginAttempt(ctx context.Context, host string, usernameKey []byte, at time.Time) (int64, error) {
	if _, err := s.Pool.Exec(ctx, `delete from app.host_login_attempts where host = $1 and at < $2`, host, at.Add(-attemptsKept)); err != nil {
		return 0, fmt.Errorf("hosts: trim login attempts: %w", err)
	}
	var id int64
	if err := s.Pool.QueryRow(ctx, `insert into app.host_login_attempts (host, username_key, at) values ($1, $2, $3) returning id`,
		host, usernameKey, at).Scan(&id); err != nil {
		return 0, fmt.Errorf("hosts: keep login attempt: %w", err)
	}
	return id, nil
}

// LoginRefused marks an attempt the host refused.
func (s *Store) LoginRefused(ctx context.Context, id int64) error {
	if _, err := s.Pool.Exec(ctx, `update app.host_login_attempts set refused = true where id = $1`, id); err != nil {
		return fmt.Errorf("hosts: keep login refusal: %w", err)
	}
	return nil
}

// LoginAttempts is the host's sign-in attempts since a moment, across
// every account, and the refused ones for the username key.
func (s *Store) LoginAttempts(ctx context.Context, host string, usernameKey []byte, since time.Time) (total, refused int, err error) {
	err = s.Pool.QueryRow(ctx, `select count(*), count(*) filter (where refused and username_key = $2)
		from app.host_login_attempts where host = $1 and at >= $3`, host, usernameKey, since).Scan(&total, &refused)
	if err != nil {
		return 0, 0, fmt.Errorf("hosts: count login attempts: %w", err)
	}
	return total, refused, nil
}
