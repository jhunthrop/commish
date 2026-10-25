package config

import (
	"errors"
	"testing"
)

// The runs' bucket takes the exports' account and endpoint and its own
// read-only keys, never the exports' write keys; half a pair is refused.
func TestRunsBucket(t *testing.T) {
	exports := R2{AccountID: "acct", Endpoint: "https://r2.example", AccessKeyID: "write-id", SecretAccessKey: "write-secret", Bucket: "commish-exports"}
	cases := []struct {
		name       string
		env        map[string]string
		configured bool
		bucket     string
		refused    bool
	}{
		{name: "no keys: not configured, never the exports' keys", env: map[string]string{}, bucket: defaultRunsBucket},
		{name: "both keys", env: map[string]string{"R2_RUNS_ACCESS_KEY_ID": "read-id", "R2_RUNS_SECRET_ACCESS_KEY": "read-secret"}, configured: true, bucket: defaultRunsBucket},
		{name: "a bucket named", env: map[string]string{"R2_RUNS_ACCESS_KEY_ID": "read-id", "R2_RUNS_SECRET_ACCESS_KEY": "read-secret", "R2_RUNS_BUCKET": "runs-dev"}, configured: true, bucket: "runs-dev"},
		{name: "the id alone", env: map[string]string{"R2_RUNS_ACCESS_KEY_ID": "read-id"}, bucket: defaultRunsBucket, refused: true},
		{name: "the secret alone", env: map[string]string{"R2_RUNS_SECRET_ACCESS_KEY": "read-secret"}, bucket: defaultRunsBucket, refused: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			l := &loader{get: func(name string) string { return c.env[name] }}
			got := l.runs(exports)
			if got.Configured() != c.configured || got.Bucket != c.bucket {
				t.Fatalf("configured %v bucket %q; want %v %q", got.Configured(), got.Bucket, c.configured, c.bucket)
			}
			if got.AccountID != exports.AccountID || got.Endpoint != exports.Endpoint {
				t.Fatalf("account %q endpoint %q; want the exports'", got.AccountID, got.Endpoint)
			}
			if got.AccessKeyID == exports.AccessKeyID || got.SecretAccessKey == exports.SecretAccessKey {
				t.Fatal("the runs' bucket took the exports' keys")
			}
			if err := l.err(); (err != nil) != c.refused || (c.refused && !errors.Is(err, ErrInvalid)) {
				t.Fatalf("err %v; want refused %v", err, c.refused)
			}
		})
	}
}
