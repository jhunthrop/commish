package main

import (
	"context"
	"testing"
	"time"
)

// A local research service on plain http is called without an identity token, with the configured timeout;
// only an https one (Cloud Run behind IAM) gets the token client.
func TestServiceClientLocal(t *testing.T) {
	client, err := serviceClient(context.Background(), "http://localhost:18081", 250*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	if client.Timeout != 250*time.Millisecond || client.Transport != nil {
		t.Fatalf("a local advisor got %+v, want a plain client with the timeout", client)
	}
}
