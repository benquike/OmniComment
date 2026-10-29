# OmniComment Angular SSR Application Server

Production-ready backend and SSR integration for **Angular 17 / 18 / 19** applications, combining an **Express SSR server**, **OmniComment REST persistence API**, and **reactive RxJS client service & standalone component**.

---

## Features

- **Integrated Angular SSR & API**: Hosts both the Angular SSR application views and the comments persistence REST API in a unified Node.js process (`server.ts`).
- **Reactive Angular Service**: Type-safe [`OmniCommentService`](src/app/services/omni-comment.service.ts) using RxJS `Observable`s.
- **SSR-Safe Standalone Component**: [`OmniCommentComponent`](src/app/components/omni-comment/omni-comment.component.ts) with browser-guarding to prevent SSR hydration mismatches.
- **Atomic Persistent Storage**: In-memory caching with atomic disk writes (`comments.json`).
- **Full REST Compliance**: Implements the standard OmniComment REST contract (`GET`, `POST`, `PATCH`, `DELETE`, `/replies`).

---

## Directory Structure

```text
servers/angular-ssr/
├── server.ts                                   # Angular SSR & Express REST API server
├── package.json                                # Server dependencies & scripts
├── tsconfig.json                               # TypeScript configuration
├── Dockerfile                                  # Production container build
├── README.md                                   # Quickstart guide
└── src/
    └── app/
        ├── models/
        │   └── omni-comment.model.ts          # W3C-aligned data contracts
        ├── services/
        │   └── omni-comment.service.ts        # RxJS Angular HTTP client service
        └── components/
            └── omni-comment/
                └── omni-comment.component.ts  # Standalone Angular component
```

---

## Quickstart (Local Development)

### 1. Install Dependencies
```bash
cd servers/angular-ssr
npm install
```

### 2. Run the Angular Server
```bash
npm run serve
```

The server listens on `http://localhost:4000`.

---

## REST API Specification

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Server health check and timestamp |
| `GET` | `/api/documents/:docId/comments` | List all comments for a document |
| `GET` | `/api/documents/:docId/comments/:id` | Retrieve a single comment by ID |
| `POST` | `/api/documents/:docId/comments` | Create a new comment thread |
| `PATCH`| `/api/documents/:docId/comments/:id` | Update comment / resolve / react |
| `POST` | `/api/documents/:docId/comments/:id/replies` | Append a reply to a thread |
| `DELETE`|`/api/documents/:docId/comments/:id` | Delete a comment thread |

---

## Angular Client Integration

### 1. Using the Standalone Component
```html
<omni-comment
  [target]="'#article-content'"
  [documentId]="'architecture-guide'"
  [author]="'Ada Lovelace'"
  (commentAdded)="onCommentCreated($event)"
  (commentResolved)="onCommentResolved($event)"
/>
```

### 2. Using the RxJS Service Directly
```typescript
import { Component, OnInit, inject } from '@angular/core';
import { OmniCommentService } from './services/omni-comment.service';

@Component({
  selector: 'app-doc-viewer',
  standalone: true,
  template: `
    <article id="doc-content">
      <h1>Angular Architecture</h1>
      <p>Content to comment on...</p>
    </article>
  `
})
export class DocViewerComponent implements OnInit {
  private commentService = inject(OmniCommentService);

  ngOnInit() {
    this.commentService.getComments('architecture-guide').subscribe({
      next: (comments) => console.log('Loaded comments:', comments),
      error: (err) => console.error('Failed to load comments:', err)
    });
  }
}
```

---

## Running with Docker

```bash
docker build -t omnicomment-angular-ssr .
docker run -p 4000:4000 -v $(pwd)/data:/data omnicomment-angular-ssr
```
