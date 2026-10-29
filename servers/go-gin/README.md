# OmniComment Go (Gin) Persistence Server

High-concurrency, low-latency REST API for persisting OmniComment threads, replies, and text anchors using **Go 1.21+** and the **Gin** web framework.

---

## Features

- **Blazing Performance**: Sub-millisecond JSON serialization and HTTP response times.
- **Concurrency-Safe**: Atomic in-memory lookups synchronized with `sync.RWMutex` and durable atomic disk writes.
- **Zero External CGO Dependencies**: Statically compiles to a single compact binary (<15MB).
- **CORS Configured**: Plug-and-play with `@omnicomment/web-plugin`.

---

## Quickstart (Local Development)

### 1. Download Dependencies
```bash
cd servers/go-gin
go mod tidy
```

### 2. Run Locally
```bash
go run main.go
```

The server listens on `http://localhost:8080`.

---

## Running with Docker

```bash
docker build -t omnicomment-go .
docker run -p 8080:8080 -v $(pwd)/data:/data omnicomment-go
```

---

## Client Integration (`@omnicomment/web-plugin`)

```typescript
import { initOmniComment } from '@omnicomment/web-plugin';

initOmniComment({
  target: '#article-content',
  documentId: 'architecture-spec',
  storage: {
    type: 'rest',
    endpoint: 'http://localhost:8080/api/documents/architecture-spec/comments'
  }
});
```
