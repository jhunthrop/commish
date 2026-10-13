package hosts

import (
	"context"
	"fmt"
)

// Rekey is a key rotation's re-encrypt: every connection wrapped under an
// older key version gets its data key wrapped under the current one. The
// ciphertexts are untouched and no secret is opened, only data keys. A
// row changed since it was read (a reconnect) is skipped: it is current.
//
// A rotation: create the new Secret Manager version, deploy with
// HOST_CREDENTIALS_KEY at the new version, HOST_CREDENTIALS_KEY_VERSION one
// higher and HOST_CREDENTIALS_KEY_PREVIOUS at the old, run
// `api re-encrypt-host-connections`, then drop the previous key.
func Rekey(ctx context.Context, store *Store, vault *Vault) (done, skipped int, err error) {
	if !vault.Ready() {
		return 0, 0, ErrNoKey
	}
	rows, err := store.NotAt(ctx, vault.Current())
	if err != nil {
		return 0, 0, err
	}
	for _, w := range rows {
		from := w.Sealed.KeyVersion
		next, err := vault.Rewrap(w.AccountID.String(), w.Host, w.Sealed)
		if err != nil {
			return done, skipped, fmt.Errorf("hosts: re-wrap a %s connection at version %d: %w", w.Host, from, err)
		}
		ok, err := store.Rewrapped(ctx, Wrapped{AccountID: w.AccountID, Host: w.Host, Sealed: next}, from)
		if err != nil {
			return done, skipped, err
		}
		if ok {
			done++
		} else {
			skipped++
		}
	}
	return done, skipped, nil
}
