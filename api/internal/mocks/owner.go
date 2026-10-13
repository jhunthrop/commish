package mocks

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Owner is who a mock belongs to: a signed-in account, or a browser that
// drafted signed out, named by the sha256 of its anonymous token. Exactly
// one is set; every query on a mock is scoped by it.
type Owner struct {
	Account uuid.UUID
	Token   []byte
}

// AccountOwner is a signed-in owner.
func AccountOwner(id uuid.UUID) Owner { return Owner{Account: id} }

// TokenOwner is an anonymous owner.
func TokenOwner(hash []byte) Owner { return Owner{Token: hash} }

// Anonymous reports whether the owner is a browser token.
func (o Owner) Anonymous() bool { return o.Account == uuid.Nil }

// match is the owner's filter on app.mocks aliased m, with its argument
// at position n.
func (o Owner) match(n int) (string, any) {
	if o.Anonymous() {
		return fmt.Sprintf("m.owner_token = $%d", n), o.Token
	}
	return fmt.Sprintf("m.account_id = $%d", n), o.Account
}

// columns is the owner as the insert writes it.
func (o Owner) columns() (*uuid.UUID, []byte) {
	if o.Anonymous() {
		return nil, o.Token
	}
	id := o.Account
	return &id, nil
}

func (o Owner) String() string {
	if o.Anonymous() {
		return "an anonymous browser"
	}
	return o.Account.String()
}

// Claim moves an anonymous owner's mocks to the account that signed in.
func (s *Store) Claim(ctx context.Context, accountID uuid.UUID, ownerToken []byte) (int64, error) {
	tag, err := s.Pool.Exec(ctx, `update app.mocks set account_id = $1, owner_token = null where owner_token = $2`, accountID, ownerToken)
	if err != nil {
		return 0, fmt.Errorf("mocks: claim for %s: %w", accountID, err)
	}
	return tag.RowsAffected(), nil
}

// LiveAnonymous counts an anonymous owner's unfinished mocks, which a
// create caps.
func (s *Store) LiveAnonymous(ctx context.Context, ownerToken []byte) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `select count(*) from app.mocks where owner_token = $1 and status = 'active'`, ownerToken).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("mocks: count anonymous: %w", err)
	}
	return n, nil
}

// SweepUnclaimed deletes the anonymous mocks nobody has touched or
// claimed since before, with their logs and cards.
func (s *Store) SweepUnclaimed(ctx context.Context, before time.Time) (int64, error) {
	tag, err := s.Pool.Exec(ctx, `delete from app.mocks where owner_token is not null and updated_at < $1`, before)
	if err != nil {
		return 0, fmt.Errorf("mocks: sweep unclaimed: %w", err)
	}
	return tag.RowsAffected(), nil
}
