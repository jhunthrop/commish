package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"regexp"
)

// PKCE (RFC 7636, RFC 8252 §8.1) binds an app's pairing code to the app
// that began the sign-in: the app keeps a random verifier, sends its S256
// challenge on /auth/login, and must show the verifier at /devices/pair.
// A code read off a link, a history entry or a log pairs nothing without
// it, and a link planted on someone else's phone fails there.

// PKCEMethod is the one challenge method accepted.
const PKCEMethod = "S256"

var (
	// A verifier is 43 to 128 unreserved characters (RFC 7636 §4.1).
	verifierShape = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)
	// An S256 challenge is 32 bytes in base64url with no padding.
	challengeShape = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
)

// PKCEChallenge is the S256 challenge of a verifier:
// base64url(SHA-256(verifier)) with no padding.
func PKCEChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// ValidVerifier reports whether s has a verifier's shape.
func ValidVerifier(s string) bool { return verifierShape.MatchString(s) }

// ValidChallenge reports whether s has an S256 challenge's shape.
func ValidChallenge(s string) bool { return challengeShape.MatchString(s) }
