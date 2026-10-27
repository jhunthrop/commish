// Package headshots builds the address of our copy of a player's headshot
// (Lane 241): research's `headshots` job keeps one copy per player per season
// in the images bucket, public at ImagesOrigin, and records each in
// research.headshot_copies. Every headshot field the API answers is this
// address, or null (or "" where the field is not nullable) for a player the
// season has no copy of; never a third party's image. Research builds the
// same address (research/headshots/config.py) and the web reads it
// (web/src/lib/ui/headshot.ts); each pins one example URL in its tests.
package headshots

import (
	"regexp"
	"strconv"
)

// ImagesOrigin is the images bucket's public custom domain.
const ImagesOrigin = "https://images.trycommish.app"

// AppWidth is the width answered: the apps' largest face, 72 pt at 3x.
const AppWidth = 320

// Table is the copies' ledger in the research schema.
const Table = "headshot_copies"

// FaceStatuses are the ledger statuses a face is answered for, as SQL.
const FaceStatuses = `('copied', 'curated')`

var playerID = regexp.MustCompile(`^[0-9]{1,12}$`)

// providerImage is the provider's headshot address, NFL or college, keyed
// by the provider id the product names players by: what a sheet row saved
// before the copies (and the previous web, for one deploy) carries.
var providerImage = regexp.MustCompile(`^https://a\.espncdn\.com/i/headshots/(?:nfl|college-football)/players/full/([0-9]{1,12})\.png$`)

// ours is a copy's address on our host.
var ours = regexp.MustCompile(`^` + regexp.QuoteMeta(ImagesOrigin) + `/headshots/[0-9]{4}/[0-9]{1,12}/[0-9]{2,3}\.webp$`)

// Stored is a saved face as the api answers it: our address as it is, the
// provider's headshot moved to our copy's address for the season, and any
// other address nil, so no answer names a third party's image.
func Stored(season int, url *string) *string {
	if url == nil {
		return nil
	}
	if ours.MatchString(*url) {
		return url
	}
	if m := providerImage.FindStringSubmatch(*url); m != nil {
		moved := URL(season, m[1])
		return &moved
	}
	return nil
}

// URL is the copy's address for the player in the season, "" for an id
// that cannot name a copy (a defense's synthetic id).
func URL(season int, id string) string {
	if !playerID.MatchString(id) {
		return ""
	}
	return ImagesOrigin + "/headshots/" + strconv.Itoa(season) + "/" + id + "/" + strconv.Itoa(AppWidth) + ".webp"
}
