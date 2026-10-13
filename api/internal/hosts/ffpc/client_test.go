package ffpc

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// A stand-in for FFPC's site with the sign-in form's real field names:
// the test never reaches FFPC and holds no real credential.
const (
	testUser  = "member@example.invalid"
	testPass  = "not-a-real-password"
	testLTUID = "F3C-781497793F8E"
)

type fakeFFPC struct {
	mu     sync.Mutex
	agents []string
	times  []time.Time
	posted map[string]string
	// signIns counts posts to the sign-in form.
	signIns int
	// stillOut sends every league page away, signed in or not.
	stillOut bool
	// challenge adds a field the known form lacks.
	challenge bool
	// ignoreSignIn answers a right sign-in with the form again and no
	// refusal, as a sign-in FFPC drops without saying why.
	ignoreSignIn bool
}

// The stand-in's own cookies: the server session the form is issued
// under (HttpOnly, as FFPC sets it), and an HttpOnly sign-in cookie a
// browser's script never sees, so no list of names copied from a
// browser could have known it.
const (
	testServerSession = "srv-session-1"
	testAuthCookie    = ".ASPXAUTH"
	testAuthValue     = "auth-ticket-1"
)

// hasCookie reports the request carrying the cookie with the value.
func hasCookie(r *http.Request, name, value string) bool {
	c, err := r.Cookie(name)
	return err == nil && c.Value == value
}

func (f *fakeFFPC) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.agents = append(f.agents, r.UserAgent())
	f.times = append(f.times, time.Now())
	f.mu.Unlock()
	// FFPC keeps the sign-in in its server session: a request without the
	// session the form was issued under, or without the sign-in cookie, is
	// a signed-out visitor.
	inSession := hasCookie(r, "ASP.NET_SessionId", testServerSession)
	signedIn := inSession && hasCookie(r, "BGSLMAuthenticated", "yes") && hasCookie(r, testAuthCookie, testAuthValue)
	switch {
	case r.URL.Path == loginPath && r.Method == http.MethodGet:
		http.SetCookie(w, &http.Cookie{Name: "ASP.NET_SessionId", Value: testServerSession, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
		http.SetCookie(w, &http.Cookie{Name: "BGSLMSession", Value: "sessionID=ABC", Path: "/"})
		extra := ""
		if f.challenge {
			extra = `<input name="txtSecurityCode" type="text" />`
		}
		fmt.Fprint(w, `<form method="post" action="./Login.aspx" id="form1">`+extra+`<input type="hidden" name="__VIEWSTATE" value="vs1" />
			<input type="hidden" name="__EVENTVALIDATION" value="ev1" /><input name="txtExistingUsername" type="text" />
			<input name="txtExistingPassword" type="password" /><input type="submit" name="btnSignIn" value="SIGN IN" /></form>`)
	case r.URL.Path == loginPath && r.Method == http.MethodPost:
		_ = r.ParseForm()
		f.mu.Lock()
		f.signIns++
		f.posted = map[string]string{}
		for k := range r.PostForm {
			f.posted[k] = r.PostForm.Get(k)
		}
		f.mu.Unlock()
		right := r.PostForm.Get(fieldUser) == testUser && r.PostForm.Get(fieldPass) == testPass && r.PostForm.Get("__VIEWSTATE") == "vs1"
		switch {
		case !inSession || f.ignoreSignIn:
			// A post outside the form's session: the form again, no refusal.
			fmt.Fprint(w, `<form id="form1"><span id="spnSignInError"></span></form>`)
		case right:
			http.SetCookie(w, &http.Cookie{Name: "BGSLMAuthenticated", Value: "yes", Path: "/"})
			http.SetCookie(w, &http.Cookie{Name: testAuthCookie, Value: testAuthValue, Path: "/", HttpOnly: true})
			http.SetCookie(w, &http.Cookie{Name: "Stale", Value: "gone", Path: "/", MaxAge: -1})
			http.SetCookie(w, &http.Cookie{Name: "BGSLMSession", Value: "sessionID=DEF", Path: "/"})
			http.Redirect(w, r, "/MyTeams.aspx", http.StatusFound)
		default:
			fmt.Fprint(w, `<form id="form1"><span id="spnSignInError">Invalid email/password</span></form>`)
		}
	case r.URL.Path == myTeamsPath && !signedIn:
		http.Redirect(w, r, "/cms/public", http.StatusFound)
	case r.URL.Path == myTeamsPath && r.Method == http.MethodGet:
		page, _ := os.ReadFile(filepath.Join("testdata", "ffpc-my-teams.html"))
		// The capture dropped the hidden fields and the links' targets;
		// the stand-in puts back the shape the live page has.
		body := strings.Replace(string(page), `id="cphContent_cphContent_cphContent_rptUsersTeamsDraftComplete_lnkLeagueName_0" href="`,
			`id="cphContent_cphContent_cphContent_rptUsersTeamsDraftComplete_lnkLeagueName_0" href="javascript:__doPostBack('ctl00$lnk0','')" data-x="`, 1)
		fmt.Fprint(w, `<form id="form1"><input type="hidden" name="__VIEWSTATE" value="vs2" />`+body+`</form>`)
	case r.URL.Path == myTeamsPath && r.Method == http.MethodPost:
		_ = r.ParseForm()
		if r.PostForm.Get("__EVENTTARGET") == "ctl00$lnk0" && r.PostForm.Get("__VIEWSTATE") == "vs2" {
			http.Redirect(w, r, "/LeagueHome.aspx?ltuid="+testLTUID, http.StatusFound)
			return
		}
		w.WriteHeader(http.StatusOK)
	case r.URL.Path == "/Standings.aspx" && (!signedIn || f.stillOut):
		http.Redirect(w, r, "/MyTeams.aspx", http.StatusFound)
	case r.URL.Path == "/Standings.aspx":
		page, _ := os.ReadFile(filepath.Join("testdata", "ffpc-standings.html"))
		_, _ = w.Write(page)
	default:
		http.NotFound(w, r)
	}
}

func testClient(t *testing.T) (*Client, *fakeFFPC) {
	t.Helper()
	fake := &fakeFFPC{}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	c := NewAt(srv.URL)
	c.Pace = LocalPace(20 * time.Millisecond)
	return c, fake
}

func TestSignInReadAndOpenLeague(t *testing.T) {
	c, fake := testClient(t)
	ctx := context.Background()
	jar, leagues, err := c.SignIn(ctx, testUser, testPass)
	if err != nil {
		t.Fatal(err)
	}
	if len(leagues) != 2 || leagues[0].LeagueID != "104870" {
		t.Fatalf("leagues %+v", leagues)
	}
	// Every cookie FFPC set across the form, the post and its redirect,
	// and none it expired.
	if jar["BGSLMAuthenticated"] != "yes" || jar["BGSLMSession"] != "sessionID=DEF" ||
		jar["ASP.NET_SessionId"] != testServerSession || jar[testAuthCookie] != testAuthValue {
		t.Fatalf("jar keeps %v", keys(jar))
	}
	if _, ok := jar["Stale"]; ok {
		t.Fatal("the jar keeps a cookie FFPC expired")
	}
	if fake.posted[fieldSubmit] != submitValue || fake.posted["__EVENTVALIDATION"] != "ev1" {
		t.Fatalf("the post did not echo the form: %v", keys(fake.posted))
	}
	page, jar, err := c.Page(ctx, jar, PageStandings, testLTUID)
	if err != nil {
		t.Fatal(err)
	}
	if list, err := ParseStandings(page); err != nil || len(list) != 12 {
		t.Fatalf("standings read %d (%v)", len(list), err)
	}
	ltuid, err := c.OpenLeague(ctx, jar, "104870")
	if err != nil || ltuid != testLTUID {
		t.Fatalf("open league: %q %v", ltuid, err)
	}
	for _, ua := range fake.agents {
		if ua != UserAgent {
			t.Fatalf("user agent %q", ua)
		}
	}
	for i := 1; i < len(fake.times); i++ {
		if gap := fake.times[i].Sub(fake.times[i-1]); gap < 15*time.Millisecond {
			t.Fatalf("requests %d and %d %v apart", i-1, i, gap)
		}
	}
}

func TestBadSignInAndSignedOut(t *testing.T) {
	c, _ := testClient(t)
	ctx := context.Background()
	_, _, err := c.SignIn(ctx, testUser, "wrong-password")
	if !errors.Is(err, ErrBadSignIn) {
		t.Fatalf("bad sign-in: %v", err)
	}
	if strings.Contains(err.Error(), "wrong-password") || strings.Contains(err.Error(), testUser) {
		t.Fatalf("the error names the sign-in: %v", err)
	}
	if _, _, err := c.Page(ctx, Cookies{"BGSLMSession": "x"}, PageStandings, testLTUID); !errors.Is(err, ErrSignedOut) {
		t.Fatalf("an old session read: %v", err)
	}
	if _, _, err := c.Page(ctx, Cookies{}, PageStandings, "../../etc"); err == nil {
		t.Fatal("a made-up league-team id was read")
	}
}

func keys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// A sign-in page that is not the form we know never gets the password.
func TestChangedFormIsNotPosted(t *testing.T) {
	c, fake := testClient(t)
	fake.challenge = true
	if _, _, err := c.SignIn(context.Background(), testUser, testPass); !errors.Is(err, ErrFormChanged) {
		t.Fatalf("a changed form: %v", err)
	}
	if fake.signIns != 0 {
		t.Fatalf("the password was posted %d times", fake.signIns)
	}
}

// A post FFPC answers without refusing, after which My Teams still sends
// the member away, is not a wrong password: it says so, with what the
// operator needs and no cookie's value.
func TestDroppedSignInIsUnexpected(t *testing.T) {
	c, fake := testClient(t)
	fake.ignoreSignIn = true
	_, _, err := c.SignIn(context.Background(), testUser, testPass)
	if !errors.Is(err, ErrUnexpected) || errors.Is(err, ErrBadSignIn) {
		t.Fatalf("a dropped sign-in: %v", err)
	}
	msg := err.Error()
	for _, want := range []string{"post 200", "ASP.NET_SessionId", "BGSLMSession", "/cms/public"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("the reason lacks %q: %s", want, msg)
		}
	}
	for _, secret := range []string{testServerSession, "sessionID=ABC", testPass, testUser} {
		if strings.Contains(msg, secret) {
			t.Fatalf("the reason names %q: %s", secret, msg)
		}
	}
}
