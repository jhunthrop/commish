package runs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"path"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// PointerTTL is how long the published run is taken as read before
// runs/latest.json is read again, and an hourly file with it. The
// answers' max-age is the same, so a client never holds a run longer.
const PointerTTL = time.Minute

// failureTTL is how long a failed first read of the pointer is answered
// again before the bucket is asked again, so a cold start against a
// bucket that is down costs one read per failureTTL, not one a request.
const failureTTL = 5 * time.Second

// readTimeout bounds one shared read of the bucket, apart from the
// request that started it, so one caller leaving cancels no other's.
const readTimeout = 10 * time.Second

// hourlyTagBytes is how much of an hourly file's digest its ETag carries.
const hourlyTagBytes = 8

// Answer is one file's answer from the published run: the envelope's
// data, and the ETag that names it.
type Answer struct {
	RunID string
	ETag  string
	Data  json.RawMessage
}

// cached is a file's answer in the published run, or the error its last
// read failed with, answered again until failureTTL after readAt.
type cached struct {
	answer Answer
	err    error
	readAt time.Time
}

// Reader is the published run, its pointer read every PointerTTL and its
// files read once each per run (an hourly file once per PointerTTL).
type Reader struct {
	objects Objects
	now     func() time.Time
	log     *slog.Logger
	group   singleflight.Group

	mu        sync.Mutex
	runID     string
	checkedAt time.Time
	// failed is the last pointer read's error while no run is published,
	// answered again until failureTTL after checkedAt.
	failed error
	// answers are the published run's alone, by file path: a new run
	// drops the last one's.
	answers map[string]cached
	// reach is the season reach pass's state for one run (reach.go), and
	// reachTimeout its own budget, apart from a file's readTimeout.
	reach        reachMemo
	reachTimeout time.Duration
}

// NewReader reads the published run from objects.
func NewReader(objects Objects, now func() time.Time, log *slog.Logger) *Reader {
	return &Reader{objects: objects, now: now, log: log, answers: map[string]cached{}, reachTimeout: reachTimeout}
}

// Published is the run runs/latest.json names. A run whose manifest is
// missing or names another run is refused, as the web's reader refuses
// it. When the pointer cannot be read the run already published stays,
// read again after PointerTTL.
func (r *Reader) Published(ctx context.Context) (string, error) {
	r.mu.Lock()
	current, checkedAt, failed := r.runID, r.checkedAt, r.failed
	r.mu.Unlock()
	if current != "" && r.now().Sub(checkedAt) < PointerTTL {
		return current, nil
	}
	if current == "" && failed != nil && r.now().Sub(checkedAt) < failureTTL {
		return "", failed
	}
	v, err, _ := r.group.Do("pointer", func() (any, error) {
		return r.readPointer(ctx, current)
	})
	r.mu.Lock()
	defer r.mu.Unlock()
	r.checkedAt, r.failed = r.now(), nil
	if err != nil {
		if r.runID == "" {
			r.failed = err
			return "", err
		}
		r.log.Warn("runs: the latest pointer did not read; the published run stays", "run_id", r.runID, "err", err)
		return r.runID, nil
	}
	if id := v.(string); id != r.runID {
		r.runID, r.answers = id, map[string]cached{}
	}
	return r.runID, nil
}

func (r *Reader) readPointer(ctx context.Context, current string) (string, error) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), readTimeout)
	defer cancel()
	raw, err := r.objects.Get(ctx, path.Join(runsPrefix, latestPointer))
	if err != nil {
		return "", err
	}
	var pointer struct {
		RunID string `json:"runId"`
	}
	if err := json.Unmarshal(raw, &pointer); err != nil {
		return "", fmt.Errorf("runs: %s: %w", latestPointer, err)
	}
	if !runIDPattern.MatchString(pointer.RunID) {
		return "", fmt.Errorf("runs: %s names %q, not a run id", latestPointer, pointer.RunID)
	}
	if pointer.RunID == current {
		return current, nil
	}
	return pointer.RunID, r.checkManifest(ctx, pointer.RunID)
}

// checkManifest refuses a run whose manifest is missing (a run still
// being written) or says it is another run.
func (r *Reader) checkManifest(ctx context.Context, runID string) error {
	raw, err := r.objects.Get(ctx, fileKey(runID, manifestPath))
	if err != nil {
		return fmt.Errorf("runs: run %s has no manifest it can be read by: %w", runID, err)
	}
	var manifest struct {
		RunID string `json:"runId"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return fmt.Errorf("runs: run %s manifest: %w", runID, err)
	}
	if manifest.RunID != runID {
		return fmt.Errorf("runs: the manifest of run %s says it is run %q", runID, manifest.RunID)
	}
	return nil
}

// Read is a file's answer from the published run.
func (r *Reader) Read(ctx context.Context, a artifact) (Answer, error) {
	runID, err := r.Published(ctx)
	if err != nil {
		return Answer{}, err
	}
	return r.ReadIn(ctx, runID, a)
}

// ReadIn is a file's answer from the run runID, so two files one answer
// rests on come from one run even when the pointer moves between their
// reads. Only the published run's answers are cached: a run the pointer
// has moved past is read again (runs are never rewritten, so it reads
// the same).
func (r *Reader) ReadIn(ctx context.Context, runID string, a artifact) (Answer, error) {
	r.mu.Lock()
	hit, ok := r.answers[a.path]
	r.mu.Unlock()
	ok = ok && hit.answer.RunID == runID
	if ok && hit.err != nil {
		if r.now().Sub(hit.readAt) < failureTTL {
			return Answer{}, hit.err
		}
		ok = false
	}
	if ok && (!a.hourly || r.now().Sub(hit.readAt) < PointerTTL) {
		return hit.answer, nil
	}
	v, err, _ := r.group.Do(fileKey(runID, a.path), func() (any, error) {
		return r.load(ctx, runID, a)
	})
	if err != nil {
		if !ok {
			// A file that will not read is answered with its error for
			// failureTTL, so a refused file costs one bucket read per
			// failureTTL, not one a request.
			r.keep(runID, a.path, cached{answer: Answer{RunID: runID}, err: err, readAt: r.now()})
			return Answer{}, err
		}
		// An hourly file's re-read failed: the last good copy stands, read
		// again after PointerTTL.
		r.log.Warn("runs: a re-read failed; the last copy stays", "run_id", runID, "file", a.path, "err", err)
		r.keep(runID, a.path, cached{answer: hit.answer, readAt: r.now()})
		return hit.answer, nil
	}
	answer := v.(Answer)
	r.keep(runID, a.path, cached{answer: answer, readAt: r.now()})
	return answer, nil
}

// keep caches a file's answer or failure while runID is the published run.
func (r *Reader) keep(runID, file string, c cached) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.runID == runID {
		r.answers[file] = c
	}
}

func (r *Reader) load(ctx context.Context, runID string, a artifact) (Answer, error) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), readTimeout)
	defer cancel()
	var fields []field
	raw, err := r.objects.Get(ctx, fileKey(runID, a.path))
	switch {
	case errors.Is(err, ErrNotFound) && a.optional:
		fields = []field{{a.name, json.RawMessage("null")}}
	case err != nil:
		return Answer{}, err
	default:
		if fields, err = a.shape(raw); err != nil {
			return Answer{}, fmt.Errorf("runs: run %s: %w", runID, err)
		}
	}
	data, err := encodeAnswer(runID, fields)
	if err != nil {
		return Answer{}, fmt.Errorf("runs: run %s %s: %w", runID, a.path, err)
	}
	return Answer{RunID: runID, ETag: etag(runID, a, data), Data: data}, nil
}

// etag names the run and the file; an hourly file's adds a digest of
// what it holds, since the run's id stays while it is written again. It
// is weak: the gzip and the plain body of one answer share it.
func etag(runID string, a artifact, data []byte) string {
	tag := runID + "/" + a.path
	if a.hourly {
		sum := sha256.Sum256(data)
		tag += "@" + hex.EncodeToString(sum[:hourlyTagBytes])
	}
	return `W/"` + tag + `"`
}

func fileKey(runID, file string) string { return path.Join(runsPrefix, runID, file) }
