FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod go.sum* ./
RUN go mod download || true

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o omnicomment-server .

FROM alpine:latest

WORKDIR /app
RUN apk --no-cache add ca-certificates tzdata
RUN mkdir -p /data

COPY --from=builder /app/omnicomment-server .

ENV PORT=8080 \
    OMNICOMMENT_DATA_PATH=/data/comments.json

EXPOSE 8080

CMD ["./omnicomment-server"]
