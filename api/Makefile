# api/Makefile. Run from api/.
VERSION ?= $(shell git rev-parse --short HEAD)
LDFLAGS := -s -w -X main.version=$(VERSION)
CMDS := api room migrate

# The Postgres 16 service docker-compose.test.yml starts, the same port
# and credentials as CI's.
TEST_DATABASE_URL ?= postgres://commish:commish@localhost:5433/commish_test?sslmode=disable

# The web lane's generated types, tracked in git. They are written by
# openapi-typescript and then put through the web app's own eslint fix
# and prettier, so `npm run lint` in web/ passes on them unchanged.
OPENAPI_TYPESCRIPT := openapi-typescript@7.13.0
WEB_DIR := ../web
WEB_TYPES := src/lib/api/types.ts
GO_TYPES := internal/apitypes

.PHONY: build vet test db-up db-down gen gen-go gen-types web-deps check-gen image

build:
	@mkdir -p bin
	@for c in $(CMDS); do go build -trimpath -ldflags "$(LDFLAGS)" -o bin/$$c ./cmd/$$c || exit 1; done

vet:
	go vet ./...

# -p 1: the database-backed packages share one database and each resets
# the app schema, so they cannot run at once.
test:
	TEST_DATABASE_URL="$(TEST_DATABASE_URL)" go test -race -p 1 ./...

db-up:
	docker compose -f docker-compose.test.yml up -d --wait

db-down:
	docker compose -f docker-compose.test.yml down

gen: gen-go gen-types

gen-go:
	go tool oapi-codegen -config oapi-codegen.yaml openapi.yaml

web-deps:
	@test -d $(WEB_DIR)/node_modules || npm ci --prefix $(WEB_DIR) --no-audit --no-fund

gen-types: web-deps
	@mkdir -p $(dir $(WEB_DIR)/$(WEB_TYPES))
	npx --yes $(OPENAPI_TYPESCRIPT) openapi.yaml -o $(WEB_DIR)/$(WEB_TYPES)
	cd $(WEB_DIR) && npx eslint --fix $(WEB_TYPES) && npx prettier --write $(WEB_TYPES)

# CI's drift check: regenerate both, then fail on any difference from
# what is committed, including a generated file that is missing or not
# tracked at all (git diff alone would pass an untracked file). Then the
# shared sources' generated files (shared/scripts/check-gen.ts, Lane 171):
# the design tokens and the words for the web and the apps, and the
# fixtures, each regenerated into a temp dir and compared byte for byte.
SHARED_CHECK := ../shared/scripts/check-gen.ts

check-gen: gen
	@git ls-files --error-unmatch $(WEB_DIR)/$(WEB_TYPES) >/dev/null
	@out=$$(git status --porcelain -- $(GO_TYPES) $(WEB_DIR)/$(WEB_TYPES)); \
	  if [ -n "$$out" ]; then echo "generated types differ from openapi.yaml:"; echo "$$out"; \
	  git diff -- $(GO_TYPES) $(WEB_DIR)/$(WEB_TYPES) | head -40; exit 1; fi
	node $(SHARED_CHECK)

image:
	docker build --build-arg VERSION=$(VERSION) -t commish-api:local .
