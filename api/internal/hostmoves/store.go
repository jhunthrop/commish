package hostmoves

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrUsed is a confirm token that already made its move.
var ErrUsed = errors.New("hostmoves: the confirmation was already used")

// ListMax is how many moves the list answers.
const ListMax = 20

// Outcomes kept in the proof record.
const (
	OutcomeSending  = "sending"
	OutcomeNotSent  = "not_sent"
	OutcomeDone     = "done"
	OutcomeRefused  = "refused"
	OutcomePending  = "pending"
	readMatched     = "matched"
	readNotMatched  = "not_matched"
	readNotRead     = "not_read"
	uniqueViolation = "23505"
)

// Record is a move as its proof row begins: written before anything is
// sent.
type Record struct {
	AccountID    uuid.UUID
	LinkID       uuid.UUID
	Host         string
	HostLeagueID string
	Season       int
	Kind         string
	Week         int
	Digest       []byte
	// Plan is the move as the member confirmed it, in words and items.
	Plan []byte
	// Body is what is sent: never a cookie.
	Body []byte
}

// Answer is what the host made of a move, as parsed: never the host's raw
// answer, which may echo the member's SWID.
type Answer struct {
	Outcome       string
	HostStatus    int
	TransactionID string
	HostReason    string
	HostWords     string
	ReadBack      string
	// Member is how the member ESPN names on its answer compares with the
	// SWID sent (espn.MemberCheck), "" for a move never sent.
	Member string
}

// Kept is one move as the member's list shows it.
type Kept struct {
	ID         uuid.UUID
	Kind       string
	Week       int
	Sentence   string
	Outcome    string
	HostWords  *string
	CreatedAt  time.Time
	AnsweredAt *time.Time
}

// Store reads and writes the allow list and the proof records, every
// query scoped by account.
type Store struct{ Pool *pgxpool.Pool }

// Allowed reports an account on the host's allow list for the kind.
func (s *Store) Allowed(ctx context.Context, accountID uuid.UUID, host, kind string) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `select exists (select 1 from app.host_write_accounts
		where account_id = $1 and host = $2 and kind = $3)`, accountID, host, kind).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("hostmoves: allowed: %w", err)
	}
	return ok, nil
}

// Used reports a confirm token that already made its move. Begin is the
// guard that holds when two arrive at once.
func (s *Store) Used(ctx context.Context, accountID uuid.UUID, digest []byte) (bool, error) {
	var used bool
	err := s.Pool.QueryRow(ctx, `select exists (select 1 from app.host_moves where account_id = $1 and confirm_digest = $2)`,
		accountID, digest).Scan(&used)
	if err != nil {
		return false, fmt.Errorf("hostmoves: used: %w", err)
	}
	return used, nil
}

// Begin keeps the move before it is sent, once per confirm token: a
// token already used answers ErrUsed and nothing is sent.
func (s *Store) Begin(ctx context.Context, r Record) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.Pool.QueryRow(ctx, `insert into app.host_moves
		(account_id, link_id, host, host_league_id, host_season, kind, week, confirm_digest, plan, request_body)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
		r.AccountID, r.LinkID, r.Host, r.HostLeagueID, r.Season, r.Kind, r.Week, r.Digest, r.Plan, r.Body).Scan(&id)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		return uuid.Nil, ErrUsed
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("hostmoves: begin: %w", err)
	}
	return id, nil
}

// Answered keeps what the host made of the move.
func (s *Store) Answered(ctx context.Context, accountID, id uuid.UUID, a Answer, at time.Time) error {
	var status *int
	if a.HostStatus != 0 {
		status = &a.HostStatus
	}
	_, err := s.Pool.Exec(ctx, `update app.host_moves set outcome = $3, host_status = $4, host_transaction_id = nullif($5, ''),
		host_reason = nullif($6, ''), host_words = nullif($7, ''), read_back = nullif($8, ''), member_check = nullif($9, ''),
		answered_at = $10
		where account_id = $1 and id = $2`,
		accountID, id, a.Outcome, status, validText(a.TransactionID), validText(a.HostReason), validText(a.HostWords), a.ReadBack, a.Member, at)
	if err != nil {
		return fmt.Errorf("hostmoves: answered: %w", err)
	}
	return nil
}

// validText is the host's words as text Postgres keeps: invalid UTF-8 and
// NUL bytes dropped.
func validText(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r != '�' && r != 0 {
			out = append(out, r)
		}
	}
	return string(out)
}

// List is the account's last moves on the league, newest first.
func (s *Store) List(ctx context.Context, accountID, linkID uuid.UUID) ([]Kept, error) {
	rows, err := s.Pool.Query(ctx, `select id, kind, week, plan->>'sentence', outcome, host_words, created_at, answered_at
		from app.host_moves where account_id = $1 and link_id = $2 order by created_at desc limit $3`, accountID, linkID, ListMax)
	if err != nil {
		return nil, fmt.Errorf("hostmoves: list: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Kept, error) {
		var k Kept
		err := r.Scan(&k.ID, &k.Kind, &k.Week, &k.Sentence, &k.Outcome, &k.HostWords, &k.CreatedAt, &k.AnsweredAt)
		return k, err
	})
	if err != nil {
		return nil, fmt.Errorf("hostmoves: list: %w", err)
	}
	return out, nil
}
