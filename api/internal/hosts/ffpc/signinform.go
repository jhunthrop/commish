package ffpc

import (
	"net/url"
	"strings"
)

// The sign-in form as FFPC's Login.aspx had it on 2026-10-13: the email,
// the password and the submit button, beside ASP.NET's own hidden fields.
// Anything else on the form (a renamed field, a challenge, a second
// factor) means the page is not the one we know, and the password is not
// posted.
var (
	signInFields = map[string]bool{fieldUser: true, fieldPass: true, fieldSubmit: true}
	aspNetHidden = map[string]bool{
		"__EVENTTARGET": true, "__EVENTARGUMENT": true, "__VIEWSTATE": true, "__VIEWSTATEGENERATOR": true,
		"__EVENTVALIDATION": true, "__LASTFOCUS": true, "__VIEWSTATEENCRYPTED": true, "__PREVIOUSPAGE": true,
	}
)

// signInForm is the hidden fields to post back, once the form is checked
// to be the one we know; ErrFormChanged otherwise.
func signInForm(page []byte) (url.Values, error) {
	doc, err := parse(page)
	if err != nil {
		return nil, ErrFormChanged
	}
	form := first(doc, func(n *node) bool { return isTag(n, "form") && attr(n, "id") == "form1" })
	if form == nil {
		return nil, ErrFormChanged
	}
	seen := map[string]bool{}
	out := url.Values{}
	for _, in := range all(form, func(n *node) bool { return isTag(n, "input") || isTag(n, "select") || isTag(n, "textarea") }) {
		name := attr(in, "name")
		if name == "" {
			continue
		}
		hidden := isTag(in, "input") && strings.EqualFold(attr(in, "type"), "hidden")
		switch {
		case hidden && aspNetHidden[name]:
			out.Set(name, attr(in, "value"))
		case signInFields[name]:
			seen[name] = true
		default:
			return nil, ErrFormChanged
		}
	}
	if len(seen) != len(signInFields) {
		return nil, ErrFormChanged
	}
	return out, nil
}
