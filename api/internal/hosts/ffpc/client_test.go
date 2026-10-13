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

	"golang.org/x/time/rate"
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
}

func (f *fakeFFPC) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.agents = append(f.agents, r.UserAgent())
	f.times = append(f.times, time.Now())
	f.mu.Unlock()
	signedIn := false
	if c, err := r.Cookie("BGSLMAuthenticated"); err == nil && c.Value == "yes" {
		signedIn = true
	}
	switch {
	case r.URL.Path == loginPath && r.Method == http.MethodGet:
		http.SetCookie(w, &http.Cookie{Name: "BGSLMSession", Value: "sessionID=ABC"})
		fmt.Fprint(w, `<form method="post" action="./Login.aspx" id="form1"><input type="hidden" name="__VIEWSTATE" value="vs1" />
			<input type="hidden" name="__EVENTVALIDATION" value="ev1" /><input name="txtExistingUsername" type="text" />
			<input name="txtExistingPassword" type="password" /><input type="submit" name="btnSignIn" value="SIGN IN" /></form>`)
	case r.URL.Path == loginPath && r.Method == http.MethodPost:
		_ = r.ParseForm()
		f.mu.Lock()
		f.posted = map[string]string{}
		for k := range r.PostForm {
			f.posted[k] = r.PostForm.Get(k)
		}
		f.mu.Unlock()
		if r.PostForm.Get(fieldUser) == testUser && r.PostForm.Get(fieldPass) == testPass && r.PostForm.Get("__VIEWSTATE") == "vs1" {
			http.SetCookie(w, &http.Cookie{Name: "BGSLMAuthenticated", Value: "yes"})
			http.SetCookie(w, &http.Cookie{Name: "Unrelated", Value: "dropped"})
			http.Redirect(w, r, "/MyTeams.aspx", http.StatusFound)
			return
		}
		fmt.Fprint(w, `<form id="form1"><span>Invalid login</span></form>`)
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
	case r.URL.Path == "/Standings.aspx" && !signedIn:
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
	c.gap = rate.NewLimiter(rate.Every(20*time.Millisecond), 1)
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
	if jar["BGSLMAuthenticated"] != "yes" || jar["BGSLMSession"] != "sessionID=ABC" || jar["Unrelated"] != "" {
		t.Fatalf("jar keeps %v", keys(jar))
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
