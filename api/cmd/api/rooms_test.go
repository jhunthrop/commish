package main

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/config"
)

// A local advisor on plain http is called without an identity token, with the configured timeout;
// only an https advisor (Cloud Run behind IAM) gets the token client.
func TestAdvisorClientLocal(t *testing.T) {
	client, err := advisorClient(context.Background(), config.Advisor{URL: "http://localhost:18081", Timeout: 250 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	if client.Timeout != 250*time.Millisecond || client.Transport != nil {
		t.Fatalf("a local advisor got %+v, want a plain client with the timeout", client)
	}
}
