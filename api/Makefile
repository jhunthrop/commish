# api/Makefile. Run from api/.
VERSION ?= $(shell git rev-parse --short HEAD)
LDFLAGS := -s -w -X main.version=$(VERSION)
CMDS := api room migrate

# The Postgres 16 service docker-compose.test.yml starts, the same port
# and credentials as CI's.
TEST_DATABASE_URL ?= postgres://commish:commish@localhost:5433/commish_test?sslmode=disable

# The web lane's generated types. Until web/ exists in a checkout, they
# land in gen/ so the contract still compiles to TypeScript.
OPENAPI_TYPESCRIPT := openapi-typescript@7.13.0
WEB_TYPES ?= $(if $(wildcard ../web/src),../web/src/lib/api/types.ts,gen/web-types.ts)

.PHONY: build vet test db-up db-down gen gen-go gen-types check-gen image

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

gen-types:
	@mkdir -p $(dir $(WEB_TYPES))
	npx --yes $(OPENAPI_TYPESCRIPT) openapi.yaml -o $(WEB_TYPES)

# CI's drift check: the checked-in generated code matches the contract.
check-gen: gen
	git diff --exit-code -- internal/apitypes $(WEB_TYPES)

image:
	docker build --build-arg VERSION=$(VERSION) -t commish-api:local .
