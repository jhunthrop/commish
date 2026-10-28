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
	"slices"
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
	defaultRunsBucket       = "commish-runs"
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
	// URL is the runtime connection: in production the Cloud SQL socket
	// form (postgres://u:p@/commish?host=/cloudsql/<instance>), in dev and
	// CI a TCP URL.
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

// R2 addresses one private bucket: the one exports are written to, or
// the nightly runs' the /run routes read.
type R2 struct {
	AccountID       string
	AccessKeyID     string
	SecretAccessKey string
	Bucket          string
	Endpoint        string
}

// Configured reports whether the bucket can be reached.
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
	// ServiceURL is BOARDS_URL, the research boards service that scores a
	// league's own rules; empty leaves custom scoring unavailable.
	ServiceURL string
	// ServiceTimeout bounds one call to it (a cold board is under a
	// second; a cached one is a read).
	ServiceTimeout time.Duration
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
	// Runs is the nightly runs' bucket (Lane 185): R2's account and
	// endpoint with its own read-only keys, R2_RUNS_ACCESS_KEY_ID and
	// R2_RUNS_SECRET_ACCESS_KEY, so the exports' write keys never read a
	// run and the runs' keys never write.
	Runs    R2
	Mail    Mail
	Board   Board
	Advisor Advisor
	// RoomBaseURL is the room service's WebSocket origin a lobby seat is
	// handed, wss://room.trycommish.app in production.
	RoomBaseURL string
	// ShareLinkKeys are SHARE_LINK_KEYS, newest first: the newest signs a
	// share link and every one verifies, so a key rotates by putting the
	// new one first. The cookie password is always the last key, so a
	// deploy without the variable still signs, and links it signed keep
	// opening after the variable is set.
	ShareLinkKeys []string
	// Hosts is reading a member's own league on another host (FFPC).
	Hosts Hosts
	// Dev is what only a development API may do.
	Dev Dev
	// AllowedHosts are ALLOWED_HOSTS, the Host names the API answers its
	// routes on (API_BASE_URL's host by default). Any other host, its
	// run.app URL above all, gets a 404 but for the probes.
	AllowedHosts []string
	// FreeSeason is FREE_SEASON, the season year in which every member
	// holds every feature and checkout stays shut whatever the Stripe
	// keys; 0, the default, is none.
	FreeSeason int
	// Push is push delivery and the internal routes (Lane 262).
	Push Push
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
	// AllowedHosts are the Host names the room answers its routes on:
	// ALLOWED_HOSTS, or ROOM_BASE_URL's host. Its run.app URL gets a 404
	// but for the probes.
	AllowedHosts []string
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

// postgresURL accepts a TCP host (dev and CI) or a Unix socket directory
// in the host parameter (production: the Cloud SQL connection mounts
// /cloudsql/<instance>, and the URL is postgres://u:p@/db?host=<dir>).
func (l *loader) postgresURL(name, v string) {
	if v == "" {
		return
	}
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || (u.Host == "" && !socketDir(u)) {
		l.invalid(name, "must be a postgres:// URL with a host, or a host parameter naming a socket directory")
	}
}

// socketDir reports whether the URL names an absolute socket directory in
// its host parameter.
func socketDir(u *url.URL) bool {
	return strings.HasPrefix(u.Query().Get("host"), "/")
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
	// Origins separate by comma or whitespace. The deploy passes every setting through gcloud's
	// comma-delimited --set-env-vars, where a comma inside a value is a syntax error, so the
	// workflow writes the list with spaces.
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ' ' || r == '\t' || r == '\n' }) {
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

// runs is the nightly runs' bucket: the exports' account and endpoint,
// its own keys and bucket. Half a key pair is refused at start.
func (l *loader) runs(exports R2) R2 {
	r := R2{
		AccountID:       exports.AccountID,
		Endpoint:        exports.Endpoint,
		AccessKeyID:     l.optional("R2_RUNS_ACCESS_KEY_ID", ""),
		SecretAccessKey: l.optional("R2_RUNS_SECRET_ACCESS_KEY", ""),
		Bucket:          l.optional("R2_RUNS_BUCKET", defaultRunsBucket),
	}
	if (r.AccessKeyID == "") != (r.SecretAccessKey == "") {
		l.invalid("R2_RUNS_ACCESS_KEY_ID", "is set without R2_RUNS_SECRET_ACCESS_KEY, or the other way round")
	}
	return r
}

// Board and advisor defaults: the 2026 board under the v9 source names,
// checked again every five minutes (a version read, the board itself only
// once it moved, so an hourly publish shows within five minutes); the
// advisor's answer awaited 300 ms (its measured p90 is 35 to 63 ms)
// before the engine answers instead.
const (
	defaultBoardSchema    = "research"
	defaultBoardSeason    = 2026
	defaultBoardPrefix    = "commish_board_v9"
	defaultBoardTTL       = 5 * time.Minute
	defaultAdvisorTimeout = 300 * time.Millisecond
	defaultBoardsTimeout  = 5 * time.Second
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
		ServiceURL:   strings.TrimRight(l.optional("BOARDS_URL", ""), "/"),
		ServiceTimeout: time.Duration(l.positiveInt("BOARDS_TIMEOUT_MS", int(defaultBoardsTimeout/time.Millisecond))) *
			time.Millisecond,
	}
	l.postgresURL("BOARD_DATABASE_URL", b.DatabaseURL)
	l.serviceOrigin("BOARDS_URL", b.ServiceURL)
	return b
}

func (l *loader) advisor() Advisor {
	a := Advisor{
		URL:     strings.TrimRight(l.optional("ADVISOR_URL", ""), "/"),
		Timeout: time.Duration(l.positiveInt("ADVISOR_TIMEOUT_MS", int(defaultAdvisorTimeout/time.Millisecond))) * time.Millisecond,
	}
	l.serviceOrigin("ADVISOR_URL", a.URL)
	return a
}

// The season years FREE_SEASON accepts: a guard against a typo, not a
// rule about which seasons may be free.
const (
	minSeasonYear = 2026
	maxSeasonYear = 2100
)

// freeSeason is FREE_SEASON, 0 when unset.
func (l *loader) freeSeason() int {
	v := strings.TrimSpace(l.get("FREE_SEASON"))
	if v == "" {
		return 0
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < minSeasonYear || n > maxSeasonYear {
		l.invalid("FREE_SEASON", fmt.Sprintf("must be a season year from %d to %d, or empty", minSeasonYear, maxSeasonYear))
		return 0
	}
	return n
}

// serviceOrigin checks an optional research service's origin.
func (l *loader) serviceOrigin(name, v string) {
	if v == "" {
		return
	}
	if u, err := url.Parse(v); err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		l.invalid(name, "must be an http(s) origin")
	}
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
	c.Runs = l.runs(c.R2)
	c.Mail = Mail{ResendAPIKey: l.optional("RESEND_API_KEY", ""), From: l.optional("MAIL_FROM", defaultMailFrom)}
	c.Board = l.board()
	c.Advisor = l.advisor()
	c.RoomBaseURL = l.roomBaseURL(c.Env)
	c.ShareLinkKeys = append(l.secrets("SHARE_LINK_KEYS"), c.Session.CookiePassword)
	c.Hosts = l.hosts(c.Env)
	c.Dev = l.dev(c.Env)
	c.AllowedHosts = l.allowedHosts(c.HTTP.APIBaseURL, c.Env)
	c.FreeSeason = l.freeSeason()
	c.Push = l.push()
	return c, l.err()
}

// loopbackHosts are this machine's names, which a development service
// answers on and a production one never does: no production caller needs
// them, since the probes pass on any host.
var loopbackHosts = []string{"localhost", "127.0.0.1", "::1"}

// allowedHosts is ALLOWED_HOSTS, bare host names separated by spaces or
// commas (gcloud's --set-env-vars takes no comma inside a value, so the
// workflow writes spaces), or the service's base URL's host when it is
// unset; development adds the loopback names. A scheme, a path or a
// wildcard is refused: the list is exact names.
func (l *loader) allowedHosts(base string, env Env) []string {
	hosts := l.listedHosts(base)
	if env != EnvDevelopment {
		return hosts
	}
	for _, h := range loopbackHosts {
		if !slices.Contains(hosts, h) {
			hosts = append(hosts, h)
		}
	}
	return hosts
}

// listedHosts is ALLOWED_HOSTS as written, or base's host.
func (l *loader) listedHosts(base string) []string {
	raw := strings.FieldsFunc(l.get("ALLOWED_HOSTS"), func(r rune) bool { return r == ',' || r == ' ' || r == '\t' || r == '\n' })
	if len(raw) == 0 {
		if u, err := url.Parse(base); err == nil && u.Hostname() != "" {
			return []string{strings.ToLower(u.Hostname())}
		}
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, h := range raw {
		if strings.ContainsAny(h, "/:*") {
			l.invalid("ALLOWED_HOSTS", "every entry must be a bare host name like api.trycommish.app")
			continue
		}
		out = append(out, strings.ToLower(h))
	}
	return out
}

// secrets is a list of signing secrets separated by spaces or commas, each
// at least as long as the cookie password must be.
func (l *loader) secrets(name string) []string {
	var out []string
	for _, s := range strings.FieldsFunc(l.get(name), func(r rune) bool { return r == ',' || r == ' ' || r == '\t' || r == '\n' }) {
		if len(s) < minCookiePasswordLen {
			l.invalid(name, fmt.Sprintf("every key must be at least %d characters", minCookiePasswordLen))
			continue
		}
		out = append(out, s)
	}
	return out
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
	c.AllowedHosts = l.roomHosts(c.Env)
	return c, l.err()
}

// roomHosts is the room's ALLOWED_HOSTS, defaulting to ROOM_BASE_URL's
// host, which production must set.
func (l *loader) roomHosts(env Env) []string {
	return l.allowedHosts(l.roomBaseURL(env), env)
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
