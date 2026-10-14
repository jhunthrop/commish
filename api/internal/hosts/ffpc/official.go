package ffpc

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// OfficialRules reads the public official rules page a league's rules
// page links to, where FFPC states its scoring. It is read signed out:
// the page is public and no member's session goes to it.
func (c *Client) OfficialRules(ctx context.Context, href string) ([]byte, error) {
	if !officialRef.MatchString(href) {
		return nil, fmt.Errorf("ffpc: official rules address")
	}
	u, err := url.Parse(href)
	if err != nil {
		return nil, fmt.Errorf("ffpc: official rules: %w", err)
	}
	r, err := c.do(ctx, http.MethodGet, u.Path, nil, nil)
	if err != nil {
		return nil, err
	}
	if r.status == http.StatusMovedPermanently || r.status == http.StatusFound {
		// The site adds a trailing slash: one hop, on the same path only.
		loc, perr := url.Parse(r.location)
		if perr != nil || strings.TrimSuffix(loc.Path, "/") != strings.TrimSuffix(u.Path, "/") {
			return nil, fmt.Errorf("%w: official rules moved", ErrUnavailable)
		}
		if r, err = c.do(ctx, http.MethodGet, loc.Path, nil, nil); err != nil {
			return nil, err
		}
	}
	if r.status != http.StatusOK {
		return nil, fmt.Errorf("%w: official rules %d", ErrUnavailable, r.status)
	}
	return r.body, nil
}
