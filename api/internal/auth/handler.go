package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"maps"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/names"
)

// stateCookie carries the sign-in's state and return path between
// /auth/login and /auth/callback. It is host-only on the API and lives
// ten minutes.
const (
	stateCookie   = "commish_auth"
	stateTTL      = 10 * time.Minute
	maxReturnTo   = 512
	signInProblem = "/sign-in/problem"
	// appSignedIn is the app link an app's sign-in comes back to, on the
	// site, with the pairing code: the universal link on iOS and the app
	// link on Android (the web serves the association files).
	appSignedIn = "/app/signed-in"
	// SignedOutPath is where a sign-out lands on the site: the return of
	// the WorkOS logout URL for a browser and for an app alike.
	SignedOutPath = "/"
)

// Rate limits for the auth routes.
const (
	limitSignInPerMinute  = 30
	limitMeReadPerMinute  = 240
	limitMeWritePerMinute = 10
)

// AccountViewer turns an account into the API's Account, with its
// features and plans. internal/account implements it.
type AccountViewer interface {
	View(ctx context.Context, a Account) (apitypes.Account, error)
}

// AccountStore is the part of Store the handlers write through.
type AccountStore interface {
	UpsertAccount(ctx context.Context, id Identity) (Account, error)
	CreateSession(ctx context.Context, accountID uuid.UUID, tokenHash []byte, workosSID, userAgent string, now time.Time) error
	DeleteSession(ctx context.Context, tokenHash []byte) (string, error)
	// UpdateAccount writes the handle, when set, and runs also in the same
	// transaction.
	UpdateAccount(ctx context.Context, id uuid.UUID, handle *string, also func(context.Context, pgx.Tx) error) (Account, error)
}

// AppCodes mints the pairing code an app's sign-in hands back to the
// app, good for one device of kind and only with the verifier behind
// challenge. The WorkOS session the sign-in began rides on the code to
// the device it pairs, so the device's sign-out can end it.
// devices.Service implements it.
type AppCodes interface {
	AppCode(ctx context.Context, accountID uuid.UUID, kind DeviceKind, challenge, workosSID string) (string, error)
}

// Handler serves /auth and /me.
type Handler struct {
	// AppCodes mints an app's pairing code at the callback; nil sends an
	// app's sign-in to the problem page.
	AppCodes      AppCodes
	Store         AccountStore
	Sessions      *Sessions
	IdP           IdentityProvider
	Viewer        AccountViewer
	Names         *names.Filter
	PublicBaseURL string
	StateSealer   *Sealer
	TrustedHops   int
	// Anon and Claimer move a browser's signed-out mocks to the account
	// at sign-in; nil leaves them where they are.
	Anon    *Anon
	Claimer AnonClaimer
	// Deleting names the WorkOS users whose accounts were deleted here and
	// are still queued for the provider; a sign-in as one is refused. nil
	// checks nothing. deletion.Store implements it.
	Deleting DeletionQueue
	// Notifications writes the push settings PATCH /me carries; nil
	// refuses them.
	Notifications NotificationSettings
	Now           func() time.Time
	Log           *slog.Logger
}

// NotificationSettings writes the account's push settings (Lane 262).
// notify.Settings implements it.
type NotificationSettings interface {
	CheckNotifications(u apitypes.NotificationSettingsUpdate) map[string]string
	UpdateNotificationsIn(ctx context.Context, tx pgx.Tx, accountID uuid.UUID, u apitypes.NotificationSettingsUpdate) error
}

// DeletionQueue is the queue of deleted accounts' WorkOS users.
type DeletionQueue interface {
	Queued(ctx context.Context, workosUserID string) (bool, error)
}

// NewStateSealer is the sealer for the sign-in state cookie.
func NewStateSealer(password string) (*Sealer, error) { return NewSealer(password, purposeState) }

// Routes is every route this package serves.
func (h *Handler) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/auth/login", Access: httpx.Public, Limit: httpx.PerMinute(limitSignInPerMinute), Handler: h.login},
		{Method: http.MethodGet, Path: "/auth/callback", Access: httpx.Public, Limit: httpx.PerMinute(limitSignInPerMinute), Handler: h.callback},
		{Method: http.MethodPost, Path: "/auth/logout", Access: httpx.Public, Limit: httpx.PerMinute(limitSignInPerMinute), Handler: h.logout},
		{Method: http.MethodGet, Path: "/me", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitMeReadPerMinute), Handler: h.me},
		{Method: http.MethodPatch, Path: "/me", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitMeWritePerMinute), Handler: h.updateMe},
	}
}

type signInState struct {
	State    string    `json:"s"`
	ReturnTo string    `json:"r"`
	Expires  time.Time `json:"e"`
	// Client is the app signing in (ios, android), empty for the web.
	Client DeviceKind `json:"c,omitempty"`
	// Challenge is the app's S256 PKCE challenge, empty for the web.
	Challenge string `json:"p,omitempty"`
}

// safeReturnTo keeps only a path on the site: never another host, never
// a scheme, never a protocol-relative "//". Anything else becomes "/".
func safeReturnTo(raw string) string {
	if raw == "" || len(raw) > maxReturnTo || !strings.HasPrefix(raw, "/") ||
		strings.HasPrefix(raw, "//") || strings.ContainsAny(raw, "\\\r\n") {
		return "/"
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "" || u.Host != "" {
		return "/"
	}
	return raw
}

func (h *Handler) site(path string) string { return h.PublicBaseURL + path }

// appSignIn is what an app's /auth/login names: the app and the S256
// challenge of the verifier it keeps.
type appSignIn struct {
	Client    DeviceKind
	Challenge string
}

// The refusals of an app's /auth/login, by the field at fault. The apps
// show the field's sentence.
const (
	badClient          = "An app signs in as ios or android"
	badMethod          = "An app signs in with code_challenge_method S256"
	badChallenge       = "An app signs in with the S256 code_challenge of its code_verifier"
	badAppReturnPrefix = "An app comes back to "
)

// readAppSignIn reads an app's sign-in from the query: no client is the
// web (the zero value, no fault); an app names ios or android, comes back
// to the app link alone (given exactly or left out) and sends an S256
// challenge. fault names the one field at fault and its sentence.
func (h *Handler) readAppSignIn(q url.Values) (appSignIn, map[string]string) {
	if !q.Has("client") {
		return appSignIn{}, nil
	}
	kind, ok := ParseDeviceKind(q.Get("client"))
	switch {
	case !ok || !kind.IsApp():
		return appSignIn{}, map[string]string{"client": badClient}
	case q.Has("return_to") && q.Get("return_to") != h.site(appSignedIn):
		return appSignIn{}, map[string]string{"return_to": badAppReturnPrefix + h.site(appSignedIn)}
	case q.Get("code_challenge_method") != PKCEMethod:
		return appSignIn{}, map[string]string{"code_challenge_method": badMethod}
	case !ValidChallenge(q.Get("code_challenge")):
		return appSignIn{}, map[string]string{"code_challenge": badChallenge}
	}
	return appSignIn{Client: kind, Challenge: q.Get("code_challenge")}, nil
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	app, fault := h.readAppSignIn(q)
	if fault != nil {
		httpx.WriteInvalid(w, r, fault)
		return
	}
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	st := signInState{
		State:     base64.RawURLEncoding.EncodeToString(b),
		ReturnTo:  safeReturnTo(q.Get("return_to")),
		Expires:   h.Now().Add(stateTTL),
		Client:    app.Client,
		Challenge: app.Challenge,
	}
	screen := ScreenSignIn
	if r.URL.Query().Get("screen") == string(ScreenSignUp) {
		screen = ScreenSignUp
	}
	to, err := h.IdP.AuthorizationURL(st.State, screen)
	if err != nil {
		h.Log.Error("auth: login", "request_id", httpx.RequestIDFrom(r.Context()), "err", err)
		http.Redirect(w, r, h.site(signInProblem), http.StatusFound)
		return
	}
	raw, _ := json.Marshal(st)
	http.SetCookie(w, &http.Cookie{
		Name: stateCookie, Value: h.StateSealer.Seal(raw), Path: "/auth", MaxAge: int(stateTTL / time.Second),
		HttpOnly: true, Secure: h.Sessions.cookies.CookieSecure, SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, to, http.StatusFound)
}

// readState opens and spends the state cookie, checking it against the
// callback's state parameter.
func (h *Handler) readState(w http.ResponseWriter, r *http.Request) (signInState, bool) {
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Value: "", Path: "/auth", MaxAge: -1,
		HttpOnly: true, Secure: h.Sessions.cookies.CookieSecure, SameSite: http.SameSiteLaxMode})
	c, err := r.Cookie(stateCookie)
	if err != nil {
		return signInState{}, false
	}
	raw, err := h.StateSealer.Open(c.Value)
	if err != nil {
		return signInState{}, false
	}
	var st signInState
	if json.Unmarshal(raw, &st) != nil || h.Now().After(st.Expires) {
		return signInState{}, false
	}
	got := r.URL.Query().Get("state")
	if subtle.ConstantTimeCompare([]byte(got), []byte(st.State)) != 1 {
		return signInState{}, false
	}
	return st, true
}

func (h *Handler) callback(w http.ResponseWriter, r *http.Request) {
	problem := h.site(signInProblem)
	st, ok := h.readState(w, r)
	code := r.URL.Query().Get("code")
	if !ok || code == "" {
		http.Redirect(w, r, problem, http.StatusFound)
		return
	}
	id, err := h.IdP.Authenticate(r.Context(), code, httpx.ClientIP(r, h.TrustedHops), r.UserAgent())
	if err != nil {
		h.Log.Warn("auth: callback", "request_id", httpx.RequestIDFrom(r.Context()), "err", err)
		http.Redirect(w, r, problem, http.StatusFound)
		return
	}
	if h.refuseDeleted(r, id.UserID) {
		http.Redirect(w, r, problem, http.StatusFound)
		return
	}
	acct, err := h.Store.UpsertAccount(r.Context(), id)
	if err != nil {
		h.Log.Error("auth: callback", "request_id", httpx.RequestIDFrom(r.Context()), "err", err)
		http.Redirect(w, r, problem, http.StatusFound)
		return
	}
	// An app's sign-in pairs a device and makes no site session: no
	// client would hold its cookie (the app's sheet keeps its own), and
	// on a phone whose browser shares the sheet's cookies the site would
	// stay signed in after the app signs out. The WorkOS session goes to
	// the device instead.
	if st.Client.IsApp() {
		h.claimAnon(w, r, acct.ID)
		h.returnToApp(w, r, acct.ID, appSignIn{Client: st.Client, Challenge: st.Challenge}, id.SessionID)
		return
	}
	if err := h.startSiteSession(w, r, acct.ID, id.SessionID); err != nil {
		h.Log.Error("auth: callback", "request_id", httpx.RequestIDFrom(r.Context()), "err", err)
		http.Redirect(w, r, problem, http.StatusFound)
		return
	}
	h.claimAnon(w, r, acct.ID)
	http.Redirect(w, r, h.site(st.ReturnTo), http.StatusFound)
}

// refuseDeleted reports whether the WorkOS user's account was deleted here
// and the provider has not yet confirmed its own delete (Lane 233): a
// sign-in now would make a fresh account on a user the sweep is about to
// delete, an account nobody could sign in to again. A failed read refuses
// too, logged: the sign-in can be tried again in a moment.
func (h *Handler) refuseDeleted(r *http.Request, workosUserID string) bool {
	if h.Deleting == nil {
		return false
	}
	queued, err := h.Deleting.Queued(r.Context(), workosUserID)
	if err != nil {
		h.Log.Error("auth: callback deletion check", "request_id", httpx.RequestIDFrom(r.Context()), "err", err)
		return true
	}
	if queued {
		h.Log.Warn("auth: sign-in refused, the account is being deleted", "request_id", httpx.RequestIDFrom(r.Context()))
	}
	return queued
}

// startSiteSession issues a browser's session cookie for the account.
// Signing in again replaces this browser's session: the one its cookie
// names, if any, ends before the new one is issued.
func (h *Handler) startSiteSession(w http.ResponseWriter, r *http.Request, accountID uuid.UUID, workosSID string) error {
	if old, ok := h.Sessions.Token(r); ok {
		if _, err := h.Store.DeleteSession(r.Context(), hashToken(old)); err != nil {
			return err
		}
	}
	token, hash := newToken()
	if err := h.Store.CreateSession(r.Context(), accountID, hash, workosSID, r.UserAgent(), h.Now()); err != nil {
		return err
	}
	h.Sessions.Issue(w, token)
	return nil
}

// returnToApp hands a signed-in app its pairing code on the app link,
// which the app trades at POST /devices/pair, with the verifier behind
// the sealed challenge, for its device token. The link is built here
// from the site, never read from the request, so the code goes nowhere
// else, and without the verifier it pairs nothing. The code carries the
// sign-in's WorkOS session to the device.
func (h *Handler) returnToApp(w http.ResponseWriter, r *http.Request, accountID uuid.UUID, app appSignIn, workosSID string) {
	if h.AppCodes == nil || !ValidChallenge(app.Challenge) {
		h.Log.Error("auth: app sign-in", "request_id", httpx.RequestIDFrom(r.Context()), "err", "no app codes or no challenge")
		http.Redirect(w, r, h.site(signInProblem), http.StatusFound)
		return
	}
	code, err := h.AppCodes.AppCode(r.Context(), accountID, app.Client, app.Challenge, workosSID)
	if err != nil {
		h.Log.Error("auth: app sign-in", "request_id", httpx.RequestIDFrom(r.Context()), "err", err)
		http.Redirect(w, r, h.site(signInProblem), http.StatusFound)
		return
	}
	q := url.Values{"code": {code}, "client": {string(app.Client)}}
	http.Redirect(w, r, h.site(appSignedIn)+"?"+q.Encode(), http.StatusSeeOther)
}

// claimAnon moves the mocks this browser drafted signed out to the
// account it just signed in to, and retires the anonymous cookie. A
// failed claim is logged and leaves the cookie, so the next sign-in
// claims them; it never fails the sign-in.
func (h *Handler) claimAnon(w http.ResponseWriter, r *http.Request, accountID uuid.UUID) {
	if h.Anon == nil || h.Claimer == nil {
		return
	}
	owners := h.Anon.Owners(r)
	if len(owners) == 0 {
		return
	}
	var n int64
	for _, owner := range owners {
		claimed, err := h.Claimer.Claim(r.Context(), accountID, owner)
		if err != nil {
			h.Log.Error("auth: claim anonymous mocks", "request_id", httpx.RequestIDFrom(r.Context()), "err", err)
			return
		}
		n += claimed
	}
	h.Anon.Clear(w)
	h.Log.Info("auth: claimed anonymous mocks", "request_id", httpx.RequestIDFrom(r.Context()), "mocks", n)
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	to := h.site(SignedOutPath)
	if token, ok := h.Sessions.Token(r); ok {
		sid, err := h.Store.DeleteSession(r.Context(), hashToken(token))
		if err != nil {
			httpx.WriteInternal(w, r, h.Log, "auth: logout", err)
			return
		}
		if sid != "" {
			if u, err := h.IdP.LogoutURL(sid, to); err == nil {
				to = u
			} else {
				h.Log.Warn("auth: logout url", "request_id", httpx.RequestIDFrom(r.Context()), "err", err)
			}
		}
	}
	h.Sessions.Clear(w)
	httpx.WriteOK(w, r, http.StatusOK, apitypes.Redirect{Url: to})
}

func (h *Handler) writeAccount(w http.ResponseWriter, r *http.Request, a Account) {
	view, err := h.Viewer.View(r.Context(), a)
	if err != nil {
		httpx.WriteInternal(w, r, h.Log, "auth: view account", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, view)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	a, _ := AccountFrom(r.Context())
	h.writeAccount(w, r, a)
}

func (h *Handler) updateMe(w http.ResponseWriter, r *http.Request) {
	a, _ := AccountFrom(r.Context())
	var in apitypes.AccountUpdate
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	if faults := h.checkUpdate(in); faults != nil {
		httpx.WriteInvalid(w, r, faults)
		return
	}
	var also func(context.Context, pgx.Tx) error
	if in.Notifications != nil {
		update := *in.Notifications
		also = func(ctx context.Context, tx pgx.Tx) error {
			return h.Notifications.UpdateNotificationsIn(ctx, tx, a.ID, update)
		}
	}
	updated, err := h.Store.UpdateAccount(r.Context(), a.ID, in.Handle, also)
	switch {
	case errors.Is(err, ErrHandleTaken):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, "That name is taken",
			map[string]string{"handle": "That name is taken"})
		return
	case err != nil:
		httpx.WriteInternal(w, r, h.Log, "auth: update account", err)
		return
	}
	h.writeAccount(w, r, updated)
}

// Refusals of an update that changes nothing.
const (
	nothingToUpdate     = "Send a handle or notifications to change"
	notificationsClosed = "Push settings cannot be changed right now"
)

// checkUpdate is every fault in the update by field, nil when it reads,
// checked whole before anything is written, so a fault in either field
// leaves both as they were.
func (h *Handler) checkUpdate(in apitypes.AccountUpdate) map[string]string {
	if in.Handle == nil && in.Notifications == nil {
		return map[string]string{"handle": nothingToUpdate}
	}
	faults := map[string]string{}
	if in.Handle != nil {
		if err := h.Names.Check(*in.Handle); err != nil {
			faults["handle"] = err.Error()
		}
	}
	if in.Notifications != nil {
		if h.Notifications == nil {
			faults["notifications"] = notificationsClosed
		} else {
			maps.Copy(faults, h.Notifications.CheckNotifications(*in.Notifications))
		}
	}
	if len(faults) == 0 {
		return nil
	}
	return faults
}
