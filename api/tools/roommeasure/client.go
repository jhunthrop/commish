package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db"
)

// drafter is one signed-in account, its cookies minted the way the
// sign-in callback mints them.
type drafter struct {
	ID      uuid.UUID
	Handle  string
	Session string
	CSRF    string
	api     string
	http    *http.Client
}

func mint(ctx context.Context, env environment, handle string) (*drafter, error) {
	pool, err := db.Open(env.DatabaseURL)
	if err != nil {
		return nil, err
	}
	defer pool.Close()
	store := &auth.Store{Pool: pool}
	acct, err := store.UpsertAccount(ctx, auth.Identity{UserID: "measure_" + handle, Email: handle + "@example.invalid"})
	if err != nil {
		return nil, err
	}
	if acct.Handle == nil {
		if _, err := store.SetHandle(ctx, acct.ID, handle); err != nil {
			return nil, err
		}
	}
	token := make([]byte, 32)
	_, _ = rand.Read(token)
	sum := sha256.Sum256(token)
	if err := store.CreateSession(ctx, acct.ID, sum[:], "", "roommeasure", time.Now()); err != nil {
		return nil, err
	}
	seal, err := auth.NewSealer(env.Password, "commish session v1")
	if err != nil {
		return nil, err
	}
	csrf, err := auth.NewCSRFSigner(env.Password)
	if err != nil {
		return nil, err
	}
	return &drafter{ID: acct.ID, Handle: handle, Session: seal.Seal(token), CSRF: csrf.Token(sum[:]), api: env.API,
		http: &http.Client{Timeout: 30 * time.Second}}, nil
}

func (d *drafter) cookie() string { return auth.SessionCookie + "=" + d.Session }

// call is one API request; out receives the envelope's data. It answers
// the status and the wall time of the round trip, body read included.
func (d *drafter) call(ctx context.Context, method, path string, in, out any) (int, time.Duration, error) {
	var body io.Reader
	if in != nil {
		raw, err := json.Marshal(in)
		if err != nil {
			return 0, 0, err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, d.api+path, body)
	if err != nil {
		return 0, 0, err
	}
	req.Header.Set("Cookie", d.cookie())
	req.Header.Set(auth.CSRFHeader, d.CSRF)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept-Encoding", "gzip")
	began := time.Now()
	resp, err := d.http.Do(req)
	if err != nil {
		return 0, 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	reader := io.Reader(resp.Body)
	if resp.Header.Get("Content-Encoding") == "gzip" {
		gz, err := gzip.NewReader(resp.Body)
		if err != nil {
			return 0, 0, err
		}
		reader = gz
	}
	raw, err := io.ReadAll(reader)
	took := time.Since(began)
	if err != nil {
		return resp.StatusCode, took, err
	}
	var env struct {
		Data  json.RawMessage `json:"data"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return resp.StatusCode, took, fmt.Errorf("%s %s: %d %s", method, path, resp.StatusCode, raw)
	}
	if resp.StatusCode >= 300 {
		msg := ""
		if env.Error != nil {
			msg = env.Error.Message
		}
		return resp.StatusCode, took, fmt.Errorf("%s %s: %d %s", method, path, resp.StatusCode, msg)
	}
	if out != nil {
		if err := json.Unmarshal(env.Data, out); err != nil {
			return resp.StatusCode, took, err
		}
	}
	return resp.StatusCode, took, nil
}
