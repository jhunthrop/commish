// Package runs serves the published nightly run's files to the apps
// (Lane 185): the manifest, a format's board, the index, the ADP and the
// designations, read from the runs' bucket the way the web's build reads
// them (web/src/lib/server/run.ts): the run runs/latest.json names, and
// never a run whose manifest is missing or names another run. Each answer
// is the run's JSON as written inside the envelope, the run id beside it,
// cached per run and answered with an ETag and a 304.
package runs

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	smithyhttp "github.com/aws/smithy-go/transport/http"

	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/r2"
)

// ErrNotFound is the bucket holding no object at a key.
var ErrNotFound = errors.New("runs: no such object")

// maxObjectBytes bounds one read: the largest run file, a board, is a
// few hundred kilobytes.
const maxObjectBytes = 32 << 20

// Objects reads the runs' bucket by key ("runs/latest.json").
type Objects interface {
	Get(ctx context.Context, key string) ([]byte, error)
}

// R2Objects is the runs' bucket on R2, read only.
type R2Objects struct {
	api    *s3.Client
	bucket string
}

// NewR2Objects builds the bucket's reader. Nothing is dialled until the
// first read.
func NewR2Objects(cfg config.R2) (*R2Objects, error) {
	api, err := r2.NewClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("runs: %w", err)
	}
	return &R2Objects{api: api, bucket: cfg.Bucket}, nil
}

// Get reads one object whole, ErrNotFound when the bucket has none.
func (o *R2Objects) Get(ctx context.Context, key string) ([]byte, error) {
	out, err := o.api.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(o.bucket), Key: aws.String(key)})
	if err != nil {
		if missing(err) {
			return nil, fmt.Errorf("runs: get %s: %w", key, ErrNotFound)
		}
		return nil, fmt.Errorf("runs: get %s: %w", key, err)
	}
	defer func() { _ = out.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(out.Body, maxObjectBytes+1))
	if err != nil {
		return nil, fmt.Errorf("runs: read %s: %w", key, err)
	}
	if len(body) > maxObjectBytes {
		return nil, fmt.Errorf("runs: %s is over %d bytes", key, maxObjectBytes)
	}
	return body, nil
}

// missing is R2's answer for a key with no object: NoSuchKey, or a bare
// 404 when the SDK cannot name it.
func missing(err error) bool {
	var noKey *types.NoSuchKey
	if errors.As(err, &noKey) {
		return true
	}
	var resp *smithyhttp.ResponseError
	return errors.As(err, &resp) && resp.HTTPStatusCode() == http.StatusNotFound
}
