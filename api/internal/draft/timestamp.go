package draft

import (
	"fmt"
	"time"
)

// validTimestamp is zod's z.iso.datetime(): YYYY-MM-DDTHH:MM, optional
// :SS and any sub-second digits, then "Z" and nothing else.
func validTimestamp(s string) bool {
	const shape = "dddd-dd-ddTdd:dd"
	if len(s) < len(shape)+1 || s[len(s)-1] != 'Z' {
		return false
	}
	for i := 0; i < len(shape); i++ {
		if (shape[i] == 'd') != isDigit(s[i]) || (shape[i] != 'd' && s[i] != shape[i]) {
			return false
		}
	}
	if !validSecondsTail(s[len(shape) : len(s)-1]) {
		return false
	}
	_, err := ParseMillis(s)
	return err == nil
}

// validSecondsTail is "", ":SS" or ":SS.d+".
func validSecondsTail(tail string) bool {
	if tail == "" {
		return true
	}
	if len(tail) < 3 || tail[0] != ':' || !isDigit(tail[1]) || !isDigit(tail[2]) {
		return false
	}
	frac := tail[3:]
	if frac == "" {
		return true
	}
	if len(frac) < 2 || frac[0] != '.' {
		return false
	}
	for i := 1; i < len(frac); i++ {
		if !isDigit(frac[i]) {
			return false
		}
	}
	return true
}

func isDigit(b byte) bool { return b >= '0' && b <= '9' }

// ParseMillis is Date.parse for the ISO timestamps the log carries:
// milliseconds since the epoch, sub-millisecond digits dropped.
func ParseMillis(s string) (int64, error) {
	layouts := []string{time.RFC3339Nano, "2006-01-02T15:04Z07:00"}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UnixMilli(), nil
		}
	}
	return 0, fmt.Errorf("draft: %q is not an ISO timestamp", s)
}

// FormatMillis is Date.prototype.toISOString: UTC, always milliseconds.
func FormatMillis(ms int64) string {
	return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z")
}
