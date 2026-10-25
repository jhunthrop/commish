// Package exports writes a sheet as a file to the private R2 bucket and
// hands the drafter a short-lived signed link to it, through the one R2
// client (internal/r2).
package exports

import (
	"bytes"
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/r2"
)

// R2 is one bucket, ready to write, sign and delete.
type R2 struct {
	api     *s3.Client
	presign *s3.PresignClient
	bucket  string
}

// NewR2 builds the client. Nothing is dialled until the first call.
func NewR2(cfg config.R2) (*R2, error) {
	api, err := r2.NewClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("exports: %w", err)
	}
	return &R2{api: api, presign: s3.NewPresignClient(api), bucket: cfg.Bucket}, nil
}

// Put writes one object.
func (c *R2) Put(ctx context.Context, key, contentType, disposition string, body []byte) error {
	if _, err := c.api.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(c.bucket), Key: aws.String(key), Body: bytes.NewReader(body),
		ContentType: aws.String(contentType), ContentDisposition: aws.String(disposition),
		ContentLength: aws.Int64(int64(len(body))),
	}); err != nil {
		return fmt.Errorf("exports: put %s: %w", key, err)
	}
	return nil
}

// PresignGet signs a GET of key good for ttl.
func (c *R2) PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error) {
	req, err := c.presign.PresignGetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(c.bucket), Key: aws.String(key)},
		s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("exports: presign %s: %w", key, err)
	}
	return req.URL, nil
}

// Delete removes one object. A missing object is not an error.
func (c *R2) Delete(ctx context.Context, key string) error {
	if _, err := c.api.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(c.bucket), Key: aws.String(key)}); err != nil {
		return fmt.Errorf("exports: delete %s: %w", key, err)
	}
	return nil
}
