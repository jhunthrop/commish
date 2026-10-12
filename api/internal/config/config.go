// Package config reads every setting from the environment once, at
// start, and refuses to start on anything missing or malformed. Each
// command loads only what it needs (LoadAPI, LoadRoom, LoadMigrate), and
// every problem is reported at once, named, so a bad deploy says exactly
// which variables to fix. Secret values are never echoed in an error.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// Env is the deployment's environment. Production turns on Secure
// cookies and refuses the development defaults.
type Env string

const (
	EnvProduction  Env = "production"
	EnvDevelopment Env = "development"
)

// Defaults, every one of them a value a fresh deployment can run on.
const (
	defaultPort             = "8080"
	defaultTrustedProxyHops = 1
	defaultExportsBucket    = "commish-exports"
	defaultMailFrom         = "Commish <hello@trycommish.app>"
	// DevOrigin is the SvelteKit dev server. Development allows it by
	// default; production allows it only if CORS_ORIGINS names it.
	DevOrigin = "http://localhost:5173"
	// minCookiePasswordLen is the sealing key's floor, the same 32 the
	// WorkOS AuthKit SDKs require of WORKOS_COOKIE_PASSWORD.
	minCookiePasswordLen = 32
)

// ErrMissing and ErrInvalid are what every problem wraps, so a caller
// (and a test) can tell a missing variable from a malformed one.
var (
	ErrMissing = errors.New("is required")
	ErrInvalid = errors.New("is invalid")
)

// VarError names one variable and what is wrong with it.
type VarError struct {
	Name   string
	Err    error
	Reason string
}

func (e *VarError) Error() string {
	if e.Reason == "" {
		return fmt.Sprintf("config: %s %v", e.Name, e.Err)
	}
	return fmt.Sprintf("config: %s %v: %s", e.Name, e.Err, e.Reason)
}

func (e *VarError) Unwrap() error { return e.Err }

// Database is what every command that touches Postgres needs.
type Database struct {
	// URL is the runtime connection, usually Neon's pooled endpoint.
	URL string
	// MigrateURL is the connection migrations run on. Falls back to URL.
	MigrateURL string
}

// Session is what reading the sealed session cookie needs, shared by
// the api (which writes it) and the room (which only reads it).
type Session struct {
	CookieDomain   string
	CookieSecure   bool
	CookiePassword string
}

// WorkOS addresses AuthKit.
type WorkOS struct {
	ClientID    string
	APIKey      string
	RedirectURI string
}

// Stripe is billing. Configured reports false when the keys are absent,
// and the billing routes then answer 503 rather than the API refusing
// to start.
type Stripe struct {
	SecretKey     string
	WebhookSecret string
	Environment   string
	// AutomaticTax turns on Stripe Tax at checkout. It needs Stripe Tax
	// set up on the account first, or every checkout fails.
	AutomaticTax bool
}

// Configured reports whether billing can be offered.
func (s Stripe) Configured() bool { return s.SecretKey != "" && s.WebhookSecret != "" }

// R2 addresses the private bucket exports are written to.
type R2 struct {
	AccountID       string
	AccessKeyID     string
	SecretAccessKey string
	Bucket          string
	Endpoint        string
}

// Configured reports whether exports can be written.
func (r R2) Configured() bool {
	return (r.AccountID != "" || r.Endpoint != "") && r.AccessKeyID != "" && r.SecretAccessKey != "" && r.Bucket != ""
}

// Mail is the transactional mail sender the renewal reminder uses.
type Mail struct {
	ResendAPIKey string
	From         string
}

// HTTP is what both servers share about serving.
type HTTP struct {
	Port             string
	PublicBaseURL    string
	APIBaseURL       string
	CORSOrigins      []string
	TrustedProxyHops int
}

// API is cmd/api's whole configuration.
type API struct {
	Env      Env
	HTTP     HTTP
	Database Database
	Session  Session
	WorkOS   WorkOS
	Stripe   Stripe
	R2       R2
	Mail     Mail
}

// Room is cmd/room's whole configuration.
type Room struct {
	Env      Env
	HTTP     HTTP
	Database Database
	Session  Session
}

// Getenv is os.Getenv's shape, injected so tests never touch the
// process environment.
type Getenv func(string) string

// loader accumulates every problem instead of stopping at the first.
type loader struct {
	get  Getenv
	errs []error
}

func (l *loader) required(name string) string {
	v := strings.TrimSpace(l.get(name))
	if v == "" {
		l.errs = append(l.errs, &VarError{Name: name, Err: ErrMissing})
	}
	return v
}

func (l *loader) optional(name, def string) string {
	if v := strings.TrimSpace(l.get(name)); v != "" {
		return v
	}
	return def
}

// flag reads a boolean: true or false, absent meaning false.
func (l *loader) flag(name string) bool {
	switch strings.TrimSpace(l.get(name)) {
	case "", "false":
		return false
	case "true":
		return true
	default:
		l.invalid(name, "must be true or false")
		return false
	}
}

func (l *loader) invalid(name, reason string) {
	l.errs = append(l.errs, &VarError{Name: name, Err: ErrInvalid, Reason: reason})
}

func (l *loader) err() error { return errors.Join(l.errs...) }

func (l *loader) env() Env {
	v := Env(l.required("APP_ENV"))
	if v != "" && v != EnvProduction && v != EnvDevelopment {
		l.invalid("APP_ENV", "must be production or development")
	}
	return v
}

func (l *loader) database() Database {
	d := Database{URL: l.required("DATABASE_URL")}
	d.MigrateURL = l.optional("MIGRATE_DATABASE_URL", d.URL)
	l.postgresURL("DATABASE_URL", d.URL)
	l.postgresURL("MIGRATE_DATABASE_URL", d.MigrateURL)
	return d
}

func (l *loader) postgresURL(name, v string) {
	if v == "" {
		return
	}
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Host == "" {
		l.invalid(name, "must be a postgres:// URL with a host")
	}
}

func (l *loader) baseURL(name string, env Env) string {
	v := strings.TrimRight(l.required(name), "/")
	if v == "" {
		return v
	}
	u, err := url.Parse(v)
	switch {
	case err != nil || u.Host == "" || u.Path != "":
		l.invalid(name, "must be an origin like https://trycommish.app")
	case env == EnvProduction && u.Scheme != "https":
		l.invalid(name, "must be https in production")
	}
	return v
}

func (l *loader) http(env Env) HTTP {
	h := HTTP{
		Port:          l.optional("PORT", defaultPort),
		PublicBaseURL: l.baseURL("PUBLIC_BASE_URL", env),
		APIBaseURL:    l.baseURL("API_BASE_URL", env),
	}
	h.TrustedProxyHops = defaultTrustedProxyHops
	if v := l.get("TRUSTED_PROXY_HOPS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			l.invalid("TRUSTED_PROXY_HOPS", "must be an integer of 0 or more")
		}
		h.TrustedProxyHops = n
	}
	h.CORSOrigins = l.origins(env, h.PublicBaseURL)
	return h
}

// origins is CORS_ORIGINS, or the site plus (in development) the dev
// server. Every origin must be exact: no wildcard is ever honored with
// credentials.
func (l *loader) origins(env Env, site string) []string {
	raw := l.get("CORS_ORIGINS")
	if strings.TrimSpace(raw) == "" {
		out := []string{site}
		if env == EnvDevelopment {
			out = append(out, DevOrigin)
		}
		return out
	}
	var out []string
	for _, part := range strings.Split(raw, ",") {
		o := strings.TrimRight(strings.TrimSpace(part), "/")
		if o == "" {
			continue
		}
		if u, err := url.Parse(o); err != nil || u.Host == "" || o == "*" {
			l.invalid("CORS_ORIGINS", "every entry must be an exact origin")
			continue
		}
		out = append(out, o)
	}
	return out
}

func (l *loader) session(env Env) Session {
	s := Session{
		CookieDomain:   l.optional("SESSION_COOKIE_DOMAIN", ""),
		CookieSecure:   env == EnvProduction,
		CookiePassword: l.required("WORKOS_COOKIE_PASSWORD"),
	}
	if s.CookiePassword != "" && len(s.CookiePassword) < minCookiePasswordLen {
		l.invalid("WORKOS_COOKIE_PASSWORD", fmt.Sprintf("must be at least %d characters", minCookiePasswordLen))
	}
	if env == EnvProduction && s.CookieDomain == "" {
		l.errs = append(l.errs, &VarError{Name: "SESSION_COOKIE_DOMAIN", Err: ErrMissing,
			Reason: "production shares the cookie between the site and the API"})
	}
	return s
}

func (l *loader) workos(apiBase string) WorkOS {
	w := WorkOS{
		ClientID: l.required("WORKOS_CLIENT_ID"),
		APIKey:   l.required("WORKOS_API_KEY"),
	}
	w.RedirectURI = l.optional("WORKOS_REDIRECT_URI", apiBase+"/auth/callback")
	return w
}

func (l *loader) stripe() Stripe {
	s := Stripe{
		SecretKey:     l.optional("STRIPE_SECRET_KEY", ""),
		WebhookSecret: l.optional("STRIPE_WEBHOOK_SECRET", ""),
		Environment:   l.optional("STRIPE_ENVIRONMENT", "test"),
		AutomaticTax:  l.flag("STRIPE_AUTOMATIC_TAX"),
	}
	if s.SecretKey == "" {
		return s
	}
	if s.Environment != "test" && s.Environment != "live" {
		l.invalid("STRIPE_ENVIRONMENT", "must be test or live")
		return s
	}
	live := strings.HasPrefix(s.SecretKey, "sk_live_") || strings.HasPrefix(s.SecretKey, "rk_live_")
	test := strings.HasPrefix(s.SecretKey, "sk_test_") || strings.HasPrefix(s.SecretKey, "rk_test_")
	switch {
	case !live && !test:
		l.invalid("STRIPE_SECRET_KEY", "is not a Stripe secret or restricted key")
	case live != (s.Environment == "live"):
		l.invalid("STRIPE_SECRET_KEY", "does not match STRIPE_ENVIRONMENT")
	}
	if s.WebhookSecret != "" && !strings.HasPrefix(s.WebhookSecret, "whsec_") {
		l.invalid("STRIPE_WEBHOOK_SECRET", "is not a Stripe webhook signing secret")
	}
	return s
}

func (l *loader) r2() R2 {
	return R2{
		AccountID:       l.optional("R2_ACCOUNT_ID", ""),
		AccessKeyID:     l.optional("R2_ACCESS_KEY_ID", ""),
		SecretAccessKey: l.optional("R2_SECRET_ACCESS_KEY", ""),
		Bucket:          l.optional("R2_EXPORTS_BUCKET", defaultExportsBucket),
		Endpoint:        l.optional("R2_ENDPOINT", ""),
	}
}

// LoadAPI reads cmd/api's configuration.
func LoadAPI(get Getenv) (API, error) {
	l := &loader{get: get}
	c := API{Env: l.env()}
	c.HTTP = l.http(c.Env)
	c.Database = l.database()
	c.Session = l.session(c.Env)
	c.WorkOS = l.workos(c.HTTP.APIBaseURL)
	c.Stripe = l.stripe()
	c.R2 = l.r2()
	c.Mail = Mail{ResendAPIKey: l.optional("RESEND_API_KEY", ""), From: l.optional("MAIL_FROM", defaultMailFrom)}
	return c, l.err()
}

// LoadRoom reads cmd/room's configuration.
func LoadRoom(get Getenv) (Room, error) {
	l := &loader{get: get}
	c := Room{Env: l.env()}
	c.HTTP = l.http(c.Env)
	c.Database = l.database()
	c.Session = l.session(c.Env)
	return c, l.err()
}

// LoadMigrate reads cmd/migrate's configuration: only the database.
func LoadMigrate(get Getenv) (Database, error) {
	l := &loader{get: get}
	d := l.database()
	return d, l.err()
}
