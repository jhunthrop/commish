package leaguesync

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// maxOffersKept bounds the offers one read keeps: a member is offered a
// handful at most.
const maxOffersKept = 50

// HeldOffer is an offer as the last good read of its link found it, and
// when that read was.
type HeldOffer struct {
	Offer
	ReadAt time.Time
}

// PutOffers keeps a good read of the link's offers: the link's current
// offers replaced by these in one transaction, so an offer the host no
// longer holds leaves with it, and the read appended to the archive when
// it differs from the read before (an unchanged read is not archived
// again, so the archive grows with the offers, not with the reads). An
// empty read is a good read: it retires every offer the link held.
func (s *Store) PutOffers(ctx context.Context, link Link, offers []Offer, at time.Time) error {
	if len(offers) > maxOffersKept {
		offers = offers[:maxOffersKept]
	}
	raw, err := json.Marshal(offers)
	if err != nil {
		return fmt.Errorf("leaguesync: encode offers: %w", err)
	}
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('host_offers:' || $1::text))`, link.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into app.host_offer_reads (link_id, account_id, read_at, offers)
			select $1, $2, $3, $4::jsonb
			where not exists (select 1 from (select offers from app.host_offer_reads where link_id = $1
				order by read_at desc, id desc limit 1) last where last.offers = $4::jsonb)`,
			link.ID, link.AccountID, at, raw); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from app.host_offers where link_id = $1`, link.ID); err != nil {
			return err
		}
		for _, o := range offers {
			if _, err := tx.Exec(ctx, `insert into app.host_offers
				(link_id, account_id, offer_id, from_roster, give, get, drop_players, proposed_at, expires_at, read_at)
				values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (link_id, offer_id) do nothing`,
				link.ID, link.AccountID, o.OfferID, o.From, o.Give, o.Get, o.Drop, o.ProposedAt, o.ExpiresAt, at); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("leaguesync: keep offers %s: %w", link.ID, err)
	}
	return nil
}

// Offers is the account's link's offers as its last good read found
// them, the newest offer first.
func (s *Store) Offers(ctx context.Context, accountID, linkID uuid.UUID) ([]HeldOffer, error) {
	rows, err := s.Pool.Query(ctx, `select offer_id, from_roster, give, get, drop_players, proposed_at, expires_at, read_at
		from app.host_offers where link_id = $1 and account_id = $2
		order by proposed_at desc nulls last, offer_id limit $3`, linkID, accountID, maxOffersKept)
	if err != nil {
		return nil, fmt.Errorf("leaguesync: offers %s: %w", linkID, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (HeldOffer, error) {
		var o HeldOffer
		var from int16
		err := r.Scan(&o.OfferID, &from, &o.Give, &o.Get, &o.Drop, &o.ProposedAt, &o.ExpiresAt, &o.ReadAt)
		o.From = int(from)
		return o, err
	})
	if err != nil {
		return nil, fmt.Errorf("leaguesync: offers %s: %w", linkID, err)
	}
	return out, nil
}
