// Package r2 is the one way the API reaches a Cloudflare R2 bucket: R2
// speaks the S3 API, so this is the AWS SDK pointed at the account's R2
// endpoint. The exports' bucket and the nightly runs' share it.
package r2

import (
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/jhunthrop/commish/api/internal/config"
)

// NewClient builds the S3 client for cfg's bucket. Nothing is dialled
// until the first call.
func NewClient(cfg config.R2) (*s3.Client, error) {
	if !cfg.Configured() {
		return nil, fmt.Errorf("r2: bucket %q is not configured", cfg.Bucket)
	}
	return s3.NewFromConfig(aws.Config{
		// R2 has one region and calls it auto.
		Region:      "auto",
		Credentials: credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
	}, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(Endpoint(cfg))
		o.UsePathStyle = true
	}), nil
}

// Endpoint is cfg's R2_ENDPOINT, or the account's own endpoint.
func Endpoint(cfg config.R2) string {
	if cfg.Endpoint != "" {
		return cfg.Endpoint
	}
	return "https://" + cfg.AccountID + ".r2.cloudflarestorage.com"
}
