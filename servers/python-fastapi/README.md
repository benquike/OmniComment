# OmniComment Python (FastAPI) Persistence Server

Production-ready asynchronous REST API for persisting OmniComment threads, replies, and text anchors using **FastAPI**, **Pydantic v2**, and **aiosqlite**.

---

## Features

- **Pydantic v2 Validation**: Automatic snake_case to camelCase mapping for seamless `@omnicomment/web-plugin` interoperability.
- **Relational SQLite Schema**: Fast local or mounted volume storage with indexed foreign key cascading for replies.
- **Auto-Generated OpenAPI Docs**: Interactive Swagger documentation at `http://localhost:8000/docs`.
- **CORS Configured**: Ready to accept cross-origin requests from any frontend domain.

---

## Quickstart (Local Development)

### 1. Create Virtual Environment & Install Dependencies
```bash
cd servers/python-fastapi
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Run the Development Server
```bash
uvicorn main:app --reload --port 8000
```

The server is available at `http://localhost:8000`.
Visit `http://localhost:8000/docs` to test endpoints interactively via Swagger UI.

---

## Running with Docker

```bash
docker build -t omnicomment-fastapi .
docker run -p 8000:8000 -v $(pwd)/data:/data omnicomment-fastapi
```

---

## Client Integration (`@omnicomment/web-plugin`)

```typescript
import { initOmniComment } from '@omnicomment/web-plugin';

initOmniComment({
  target: '#article-content',
  documentId: 'getting-started',
  storage: {
    type: 'rest',
    endpoint: 'http://localhost:8000/api/documents/getting-started/comments'
  }
});
```
