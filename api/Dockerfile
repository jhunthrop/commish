# syntax=docker/dockerfile:1.7
# api/Dockerfile. The build context is api/:
#   docker build --build-arg VERSION=$(git rev-parse --short HEAD) -t commish-api:local api
#
# One image carries all three commands: /api, /room and /migrate. CMD
# picks which one /app (the entrypoint) is; the deploy builds the
# default (api) and points the room service and the migrate job at
# their own binaries with --command, so every service runs the same
# image digest.
FROM golang:1.25-alpine AS build
WORKDIR /src
# The module builds on its own: go.work at the repository root is not in
# this context.
ENV GOWORK=off CGO_ENABLED=0
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
ARG VERSION=dev
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    for c in api room migrate; do \
      go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/$c ./cmd/$c || exit 1; \
    done

FROM gcr.io/distroless/static-debian12:nonroot
ARG CMD=api
COPY --from=build /out/api /out/room /out/migrate /
COPY --from=build /out/${CMD} /app
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app"]
