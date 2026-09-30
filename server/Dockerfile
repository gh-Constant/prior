# syntax=docker/dockerfile:1
FROM golang:1.27-alpine AS build

WORKDIR /src/server
# Dependencies first so a code change does not download the modules again.
COPY server/go.mod server/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY server ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/prior ./cmd/prior

FROM alpine:3.21
RUN addgroup -S prior && adduser -S -G prior prior && apk add --no-cache ca-certificates wget
COPY --from=build /out/prior /usr/local/bin/prior
USER prior
ENV TZ=UTC
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/ready || exit 1
ENTRYPOINT ["/usr/local/bin/prior"]
