package leaguesync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// maxOffersKept bounds the offers one read keeps: a member is offered a
// handful at most.
const maxOffersKept = 50

// OfferReadsKept is how long the offers archive keeps a read that no
// longer describes an open offer (Lane 285, B278). The archive is the
// member's own record of what the host offered and when; ESPN and Yahoo
// expire a proposal within days, so thirty days is past any of theirs.
// MyFantasyLeague's can stay open to the trade deadline, months away, so
// age alone never prunes: a link's newest read is kept while the link
// still holds a current claim (app.host_offers), whatever its age, and
// only reads superseded by a newer one, or a retired link's last read,
// go once past thirty days (PruneOfferReads). The daily sweep job prunes,
// so a link no longer read (detached or disconnected) is pruned too,
// which a prune riding the capture would never reach.
const OfferReadsKept = 30 * 24 * time.Hour

// offerPruneBatch bounds one delete of the prune: each batch is its own
// short statement on the read_at index, so a large archive is never
// cleared under one long lock.
const offerPruneBatch = 1000

// ErrOffersNotKept is a read the store refused because its link was
// detached or its host disconnected while the read was in flight: the
// retire that went with that already holds, so the read writes nothing.
var ErrOffersNotKept = errors.New("leaguesync: the link is detached or its host disconnected")

// lockOffers takes the link's offers lock for the transaction, so a read
// being kept and a retire never interleave.
func lockOffers(ctx context.Context, tx pgx.Tx, link uuid.UUID) error {
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('host_offers:' || $1::text))`, link)
	return err
}

// retireOffers retires the current claim of each link (Lane 285, B278):
// for a link that holds offers, an empty read appended to the archive
// (the retire, recorded) and its offers deleted, in the caller's
// transaction. Locks are taken in id order, so two retires never wait on
// each other in a cycle (a read being kept holds one link's lock only).
func retireOffers(ctx context.Context, tx pgx.Tx, links []uuid.UUID) error {
	ids := slices.Clone(links)
	slices.SortFunc(ids, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	ids = slices.Compact(ids)
	for _, id := range ids {
		if err := lockOffers(ctx, tx, id); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `insert into app.host_offer_reads (link_id, account_id, read_at, offers)
		select link_id, account_id, now(), '[]'::jsonb from app.host_offers where link_id = any($1)
		group by link_id, account_id`, ids); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `delete from app.host_offers where link_id = any($1)`, ids)
	return err
}

// RetireHostOffers is hosts.Store's OnDelete: a disconnect retires the
// offers of every link the account has on the host in the disconnect's
// own transaction, so they stop being answered at once rather than when
// the last good read ages out (inseason.OfferKeptFor).
func RetireHostOffers(ctx context.Context, tx pgx.Tx, accountID uuid.UUID, host string) error {
	rows, err := tx.Query(ctx, `select id from app.league_links where account_id = $1 and host = $2`, accountID, host)
	if err != nil {
		return fmt.Errorf("leaguesync: retire offers %s: %w", host, err)
	}
	links, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return fmt.Errorf("leaguesync: retire offers %s: %w", host, err)
	}
	if err := retireOffers(ctx, tx, links); err != nil {
		return fmt.Errorf("leaguesync: retire offers %s: %w", host, err)
	}
	return nil
}

// PruneOfferReads deletes the archived offer reads older than before,
// except a link's newest read while the link holds a current claim (an
// offer it describes may still be open), in batches of offerPruneBatch,
// the sweep job's step (OfferReadsKept), and says how many went.
func (s *Store) PruneOfferReads(ctx context.Context, before time.Time) (int64, error) {
	var total int64
	for {
		tag, err := s.Pool.Exec(ctx, `delete from app.host_offer_reads where id in (
			select r.id from app.host_offer_reads r
			where r.read_at < $1
				and not (exists (select 1 from app.host_offers o where o.link_id = r.link_id)
					and r.id = (select l.id from app.host_offer_reads l where l.link_id = r.link_id
						order by l.read_at desc, l.id desc limit 1))
			limit $2)`, before, offerPruneBatch)
		if err != nil {
			return total, fmt.Errorf("leaguesync: prune offer reads: %w", err)
		}
		total += tag.RowsAffected()
		if tag.RowsAffected() < offerPruneBatch {
			return total, nil
		}
	}
}

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
// empty read is a good read: it retires every offer the link held. A read
// whose link was detached or whose host connection was deleted while it
// was in flight is refused (ErrOffersNotKept), so it never undoes the
// retire that went with them.
func (s *Store) PutOffers(ctx context.Context, link Link, offers []Offer, at time.Time) error {
	if len(offers) > maxOffersKept {
		offers = offers[:maxOffersKept]
	}
	kept := make([]Offer, len(offers))
	for i, o := range offers {
		kept[i] = o.normalized()
	}
	offers = kept
	raw, err := json.Marshal(offers)
	if err != nil {
		return fmt.Errorf("leaguesync: encode offers: %w", err)
	}
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := lockOffers(ctx, tx, link.ID); err != nil {
			return err
		}
		var live bool
		if err := tx.QueryRow(ctx, `select exists (select 1 from app.league_links l
			join app.host_connections c on c.account_id = l.account_id and c.host = l.host
			where l.id = $1 and l.detached_at is null)`, link.ID).Scan(&live); err != nil {
			return err
		}
		if !live {
			return ErrOffersNotKept
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
	if errors.Is(err, ErrOffersNotKept) {
		return err
	}
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
		err := r.Scan(&o.OfferID, &o.From, &o.Give, &o.Get, &o.Drop, &o.ProposedAt, &o.ExpiresAt, &o.ReadAt)
		return o, err
	})
	if err != nil {
		return nil, fmt.Errorf("leaguesync: offers %s: %w", linkID, err)
	}
	return out, nil
}
