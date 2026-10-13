// Command ffpcfake is a local stand-in for FFPC's site, for walking
// connect, attach, the league page and the companion without anyone's
// FFPC sign-in: it serves the captured pages in
// internal/hosts/ffpc/testdata under FFPC's own addresses, with FFPC's
// sign-in form (the same field names), its session cookies and its
// redirects. Run the api with FFPC_BASE_URL=http://localhost:<port>
// (refused in production). Any email signs in with the password
// "replay"; anything else is refused, the way FFPC refuses.
//
//	go run ./tools/ffpcfake -port 9555
package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	password = "replay"
	ltuid    = "F3C-781497793F8E"
)

func main() {
	port := flag.Int("port", 9555, "port to listen on")
	dir := flag.String("testdata", "internal/hosts/ffpc/testdata", "the captured pages")
	flag.Parse()
	srv := &http.Server{Addr: fmt.Sprintf("localhost:%d", *port), Handler: fake{dir: *dir}, ReadHeaderTimeout: 5 * time.Second}
	log.Printf("ffpc stand-in on http://localhost:%d (password %q)", *port, password)
	log.Fatal(srv.ListenAndServe())
}

type fake struct{ dir string }

// pages are the league pages by path, each a captured file.
var pages = map[string]string{
	"/LeagueHome.aspx": "ffpc-league-home.html", "/Standings.aspx": "ffpc-standings.html", "/Rosters.aspx": "ffpc-rosters.html",
	"/SetLineup.aspx": "ffpc-team-lineup.html", "/Schedule.aspx": "ffpc-schedule.html", "/Owners.aspx": "ffpc-owners.html",
	"/leagueRulesFFPC.aspx": "ffpc-rules.html", "/FreeAgents.aspx": "ffpc-free-agents.html", "/DraftBoard.aspx": "ffpc-draft-board.html",
	"/DraftReportCard.aspx": "ffpc-draft-report.html", "/Scoreboard.aspx": "ffpc-scoreboard.html",
	"/cms/public/play/big-gorilla-official-rules": "public-big-gorilla-official-rules.html",
}

func (f fake) file(w http.ResponseWriter, name string) {
	b, err := os.ReadFile(filepath.Join(f.dir, name))
	if err != nil {
		http.Error(w, "missing fixture", http.StatusInternalServerError)
		return
	}
	_, _ = w.Write(b)
}

func signedIn(r *http.Request) bool {
	c, err := r.Cookie("BGSLMAuthenticated")
	return err == nil && c.Value == "standin"
}

func (f fake) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	log.Printf("%s %s", r.Method, r.URL.Path)
	switch {
	case r.URL.Path == "/account/Login.aspx" && r.Method == http.MethodGet:
		http.SetCookie(w, &http.Cookie{Name: "BGSLMSession", Value: "sessionID=STANDIN", Path: "/"})
		fmt.Fprint(w, `<form method="post" action="./Login.aspx" id="form1"><input type="hidden" name="__VIEWSTATE" value="vs" />`+
			`<input name="txtExistingUsername" type="text" /><input name="txtExistingPassword" type="password" />`+
			`<input type="submit" name="btnSignIn" value="SIGN IN" /></form>`)
	case r.URL.Path == "/account/Login.aspx":
		_ = r.ParseForm()
		if r.PostForm.Get("txtExistingPassword") == password && r.PostForm.Get("btnSignIn") == "SIGN IN" {
			http.SetCookie(w, &http.Cookie{Name: "BGSLMAuthenticated", Value: "standin", Path: "/"})
			http.Redirect(w, r, "/MyTeams.aspx", http.StatusFound)
			return
		}
		fmt.Fprint(w, `<form id="form1"><span>Invalid login</span></form>`)
	case r.URL.Path == "/MyTeams.aspx" && !signedIn(r):
		http.Redirect(w, r, "/cms/public", http.StatusFound)
	case r.URL.Path == "/MyTeams.aspx" && r.Method == http.MethodGet:
		b, _ := os.ReadFile(filepath.Join(f.dir, "ffpc-my-teams.html"))
		body := strings.Replace(string(b), `rptUsersTeamsDraftComplete_lnkLeagueName_0" href="`,
			`rptUsersTeamsDraftComplete_lnkLeagueName_0" href="javascript:__doPostBack('ctl00$lnk0','')" data-x="`, 1)
		fmt.Fprint(w, `<form id="form1"><input type="hidden" name="__VIEWSTATE" value="vs" />`+body+`</form>`)
	case r.URL.Path == "/MyTeams.aspx":
		_ = r.ParseForm()
		if r.PostForm.Get("__EVENTTARGET") == "ctl00$lnk0" {
			http.Redirect(w, r, "/LeagueHome.aspx?ltuid="+ltuid, http.StatusFound)
			return
		}
		http.NotFound(w, r)
	case pages[r.URL.Path] != "":
		if !strings.HasPrefix(r.URL.Path, "/cms/") && (!signedIn(r) || r.URL.Query().Get("ltuid") != ltuid) {
			http.Redirect(w, r, "/MyTeams.aspx", http.StatusFound)
			return
		}
		f.file(w, pages[r.URL.Path])
	default:
		http.NotFound(w, r)
	}
}
