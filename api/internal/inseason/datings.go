package inseason

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// Datings is the capture datings every API instance shares (Lane 133,
// B110): the first instance to date a capture keeps the dating, and every
// instance after it reads it instead of dating the capture again, so a
// fresh instance serves dated statuses at once. *PGDatings implements it.
type Datings interface {
	// Dating is the runs kept for the capture digest, found false when no
	// instance has dated that capture yet.
	Dating(ctx context.Context, digest string) (map[boards.RunKey]time.Time, bool, error)
	// KeepDating keeps a capture's dating; the first writer of a digest
	// wins and a kept dating is never replaced.
	KeepDating(ctx context.Context, d Dating) error
}

// Dating is one capture's dating as kept: the capture's digest and stamp,
// its runs, and when they were read.
type Dating struct {
	Digest    string
	CaptureAt time.Time
	Runs      map[boards.RunKey]time.Time
	DatedAt   time.Time
}

// datingVersion is the digest's version: a change to what the runs read
// answers for a capture (boards.DesignationRuns) bumps it, so an instance
// on the new reading never takes a dating kept by one on the old.
const datingVersion = "runs-v1"

// DatingDigest is the capture's digest: the dating's version, the
// capture's stamp (boards.Newest, the runs read's only input from the
// capture) and each listed player under his status, in id order.
func DatingDigest(designations map[string]boards.Designation) string {
	ids := make([]string, 0, len(designations))
	for id := range designations {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var b strings.Builder
	b.WriteString(datingVersion + "\n" + boards.Newest(designations).UTC().Format(time.RFC3339Nano) + "\n")
	for _, id := range ids {
		b.WriteString(id + "\t" + designations[id].Status() + "\n")
	}
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

// DatingsTable is the shared datings' table, named in the log lines.
const DatingsTable = "app.designation_datings"

// DatingsKept is how far behind the newest capture a kept dating is
// deleted: past the oldest pair any instance still answers (PairMaxAge),
// with room for an instance whose capture read lags.
const DatingsKept = 48 * time.Hour

// PGDatings keeps the datings in app.designation_datings.
type PGDatings struct {
	Pool *pgxpool.Pool
}

// keptRun is one run as the table keeps it.
type keptRun struct {
	Player string    `json:"player"`
	Status string    `json:"status"`
	Since  time.Time `json:"since"`
}

// Dating is the runs kept for digest.
func (s *PGDatings) Dating(ctx context.Context, digest string) (map[boards.RunKey]time.Time, bool, error) {
	var raw []byte
	err := s.Pool.QueryRow(ctx, `select runs from app.designation_datings where capture_digest = $1`, digest).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("inseason: read the shared dating: %w", err)
	}
	var kept []keptRun
	if err := json.Unmarshal(raw, &kept); err != nil {
		return nil, false, fmt.Errorf("inseason: the shared dating does not read: %w", err)
	}
	runs := make(map[boards.RunKey]time.Time, len(kept))
	for _, r := range kept {
		if r.Player == "" || r.Status == "" || r.Since.IsZero() {
			return nil, false, fmt.Errorf("inseason: the shared dating holds an incomplete run %+v", r)
		}
		runs[boards.RunKey{PlayerID: r.Player, Status: r.Status}] = r.Since.UTC()
	}
	return runs, true, nil
}

// KeepDating keeps d unless its digest is kept already, and deletes the
// datings of captures over DatingsKept older than d's.
func (s *PGDatings) KeepDating(ctx context.Context, d Dating) error {
	kept := make([]keptRun, 0, len(d.Runs))
	for k, since := range d.Runs {
		kept = append(kept, keptRun{Player: k.PlayerID, Status: k.Status, Since: since.UTC()})
	}
	sort.Slice(kept, func(i, j int) bool {
		if kept[i].Player != kept[j].Player {
			return kept[i].Player < kept[j].Player
		}
		return kept[i].Status < kept[j].Status
	})
	raw, err := json.Marshal(kept)
	if err != nil {
		return fmt.Errorf("inseason: encode the dating: %w", err)
	}
	batch := &pgx.Batch{}
	batch.Queue(`insert into app.designation_datings (capture_digest, capture_at, runs, dated_at)
	values ($1, $2, $3, $4) on conflict (capture_digest) do nothing`, d.Digest, d.CaptureAt, raw, d.DatedAt)
	batch.Queue(`delete from app.designation_datings where capture_at < $1`, d.CaptureAt.Add(-DatingsKept))
	if err := s.Pool.SendBatch(ctx, batch).Close(); err != nil {
		return fmt.Errorf("inseason: keep the dating: %w", err)
	}
	return nil
}
