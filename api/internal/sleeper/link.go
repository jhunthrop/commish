package sleeper

import (
	"errors"
	"net/url"
	"strings"
)

// maxLinkLen bounds what a drafter may paste.
const maxLinkLen = 300

// ErrNotADraftLink is pasted text that names no Sleeper draft.
var ErrNotADraftLink = errors.New("sleeper: not a draft link")

// hosts are the addresses a Sleeper draft link is shared from.
func hosts() map[string]bool {
	return map[string]bool{"sleeper.com": true, "www.sleeper.com": true, "sleeper.app": true, "www.sleeper.app": true}
}

// ParseDraftLink reads the draft id out of what a drafter pasted: the id
// itself, or a link such as https://sleeper.com/draft/nfl/1382163311050645504.
// Only the id leaves this function; the link is never fetched.
func ParseDraftLink(pasted string) (string, error) {
	s := strings.TrimSpace(pasted)
	if s == "" || len(s) > maxLinkLen {
		return "", ErrNotADraftLink
	}
	if ValidID(s) {
		return s, nil
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || !hosts()[strings.ToLower(u.Hostname())] {
		return "", ErrNotADraftLink
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	for i, part := range parts {
		if part == "draft" && i+1 < len(parts) {
			// /draft/nfl/<id> or /draft/<id>.
			for _, rest := range parts[i+1:] {
				if ValidID(rest) {
					return rest, nil
				}
			}
		}
	}
	return "", ErrNotADraftLink
}
