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
	"time"
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
	defaultPort = "8080"
	// defaultMetricsPort is OpenTelemetry's Prometheus exporter port.
	defaultMetricsPort      = "9464"
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
	Port string
	// MetricsPort serves /metrics on an internal listener, never PORT.
	MetricsPort      string
	PublicBaseURL    string
	APIBaseURL       string
	CORSOrigins      []string
	TrustedProxyHops int
}

// Board is where the rooms read the board they draft from: the research
// lane's tables (spec §2.5).
type Board struct {
	// DatabaseURL reaches the research tables; empty reads them through
	// DATABASE_URL, the production shape (one database, two schemas).
	DatabaseURL string
	// Schema holds the research tables.
	Schema string
	// Season is the season the board drafts for.
	Season int
	// SourcePrefix names the stored boards, <prefix>_<format>_12.
	SourcePrefix string
	// TTL is how long a loaded board serves before it is read again.
	TTL time.Duration
}

// Advisor is the research lane's advisor service. An empty URL leaves
// the card to the engine's own room odds.
type Advisor struct {
	URL     string
	Timeout time.Duration
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
	Board    Board
	Advisor  Advisor
	// RoomBaseURL is the room service's WebSocket origin a lobby seat is
	// handed, wss://room.trycommish.app in production.
	RoomBaseURL string
}

// Room is cmd/room's whole configuration.
type Room struct {
	Env      Env
	HTTP     HTTP
	Database Database
	Session  Session
	Board    Board
	// ListenURL is a direct (unpooled) connection for LISTEN, which a
	// transaction pooler cannot carry. Falls back to DATABASE_URL.
	ListenURL string
	// Instance names this process in a room's lease.
	Instance string
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
		MetricsPort:   l.optional("METRICS_PORT", defaultMetricsPort),
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

// Board and advisor defaults: the 2026 board under the v9 source names,
// read again every fifteen minutes; the advisor's answer awaited 300 ms
// (its measured p90 is 35 to 63 ms) before the engine answers instead.
const (
	defaultBoardSchema    = "research"
	defaultBoardSeason    = 2026
	defaultBoardPrefix    = "commish_board_v9"
	defaultBoardTTL       = 15 * time.Minute
	defaultAdvisorTimeout = 300 * time.Millisecond
	defaultDevRoomBaseURL = "ws://localhost:8081"
)

func (l *loader) positiveInt(name string, def int) int {
	v := strings.TrimSpace(l.get(name))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		l.invalid(name, "must be a whole number above 0")
		return def
	}
	return n
}

func (l *loader) board() Board {
	b := Board{
		DatabaseURL:  l.optional("BOARD_DATABASE_URL", ""),
		Schema:       l.optional("BOARD_SCHEMA", defaultBoardSchema),
		Season:       l.positiveInt("BOARD_SEASON", defaultBoardSeason),
		SourcePrefix: l.optional("BOARD_SOURCE_PREFIX", defaultBoardPrefix),
		TTL:          time.Duration(l.positiveInt("BOARD_TTL_SECONDS", int(defaultBoardTTL/time.Second))) * time.Second,
	}
	l.postgresURL("BOARD_DATABASE_URL", b.DatabaseURL)
	return b
}

func (l *loader) advisor() Advisor {
	a := Advisor{
		URL:     strings.TrimRight(l.optional("ADVISOR_URL", ""), "/"),
		Timeout: time.Duration(l.positiveInt("ADVISOR_TIMEOUT_MS", int(defaultAdvisorTimeout/time.Millisecond))) * time.Millisecond,
	}
	if a.URL != "" {
		if u, err := url.Parse(a.URL); err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			l.invalid("ADVISOR_URL", "must be an http(s) origin")
		}
	}
	return a
}

func (l *loader) roomBaseURL(env Env) string {
	def := ""
	if env == EnvDevelopment {
		def = defaultDevRoomBaseURL
	}
	v := strings.TrimRight(l.optional("ROOM_BASE_URL", def), "/")
	u, err := url.Parse(v)
	switch {
	case v == "":
		l.errs = append(l.errs, &VarError{Name: "ROOM_BASE_URL", Err: ErrMissing, Reason: "a lobby seat is handed the room's socket"})
	case err != nil || u.Host == "" || (u.Scheme != "ws" && u.Scheme != "wss"):
		l.invalid("ROOM_BASE_URL", "must be a ws:// or wss:// origin")
	case env == EnvProduction && u.Scheme != "wss":
		l.invalid("ROOM_BASE_URL", "must be wss in production")
	}
	return v
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
	c.Board = l.board()
	c.Advisor = l.advisor()
	c.RoomBaseURL = l.roomBaseURL(c.Env)
	return c, l.err()
}

// LoadRoom reads cmd/room's configuration.
func LoadRoom(get Getenv) (Room, error) {
	l := &loader{get: get}
	c := Room{Env: l.env()}
	c.HTTP = l.http(c.Env)
	c.Database = l.database()
	c.Session = l.session(c.Env)
	c.Board = l.board()
	c.ListenURL = l.optional("ROOM_LISTEN_DATABASE_URL", DirectURL(c.Database.URL))
	l.postgresURL("ROOM_LISTEN_DATABASE_URL", c.ListenURL)
	// Empty names the instance by its host and a random suffix.
	c.Instance = l.optional("ROOM_INSTANCE", "")
	return c, l.err()
}

// neonPoolerSuffix marks Neon's pooled endpoint in a host name: the
// direct endpoint is the same host without it.
const neonPoolerSuffix = "-pooler."

// DirectURL is a database URL's direct (unpooled) endpoint: Neon's pooled
// host with "-pooler" taken out, any other URL as it is. LISTEN needs a
// session the pooler cannot hold.
func DirectURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || !strings.Contains(u.Host, neonPoolerSuffix) {
		return raw
	}
	u.Host = strings.Replace(u.Host, neonPoolerSuffix, ".", 1)
	return u.String()
}

// LoadMigrate reads cmd/migrate's configuration: only the database.
func LoadMigrate(get Getenv) (Database, error) {
	l := &loader{get: get}
	d := l.database()
	return d, l.err()
}
