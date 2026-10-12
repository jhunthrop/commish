// Package migrations carries the app schema's goose migrations into the
// binary, so cmd/migrate runs exactly the files this build was tested
// against. Every object lives in the app schema; nothing here ever
// touches the research schema, which the TypeScript core owns.
package migrations

import "embed"

// FS is every migration, applied in file-name order.
//
//go:embed *.sql
var FS embed.FS
