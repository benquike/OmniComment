# OmniComment Firebase Persistence Server

Production-ready backend for persisting OmniComment threads, replies, resolutions, and reactions using **Firebase Cloud Functions (v2)** and **Google Cloud Firestore**.

---

## Features

- **Serverless REST API**: High-performance HTTP endpoints powered by Express and Cloud Functions v2.
- **Real-Time Synchronization**: Native support for Firestore `onSnapshot` listeners enabling instant multi-user updates (<100ms latency).
- **Background Event Triggers**: Reactive triggers (`onCommentCreated`, `onCommentUpdated`) for webhook alerts and AI triage workflows.
- **Production Security Rules**: Schema validation in `firestore.rules` guaranteeing comment anchor integrity and preventing tampering.
- **Local Emulation**: Full offline developer workflow via the Firebase Emulator Suite.

---

## Directory Structure

```text
servers/firebase/
├── firebase.json            # Firebase CLI configuration & emulator ports
├── firestore.rules          # Production security & validation rules
├── firestore.indexes.json   # Compound query index definitions
├── package.json             # Server dependencies & deployment scripts
├── tsconfig.json            # TypeScript configuration
├── README.md                # Quickstart documentation
└── src/
    ├── index.ts             # Cloud Functions v2 entrypoint & Express API
    ├── client.ts            # Client-side SDK adapter (REST & Firestore Realtime)
    └── types.ts             # TypeScript data contracts & DTOs
```

---

## Quickstart (Local Development)

### 1. Install Dependencies
```bash
cd servers/firebase
npm install
```

### 2. Launch Local Emulator Suite
Make sure the Firebase CLI is installed (`npm install -g firebase-tools`):
```bash
npm run serve
```

This starts:
- **Functions Emulator**: `http://127.0.0.1:5001/<project-id>/us-central1/api`
- **Firestore Emulator**: `http://127.0.0.1:8080`
- **Emulator UI Dashboard**: `http://127.0.0.1:4000`

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
| `DELETE`|`/api/documents/:docId/comments/:id` | Delete or soft-delete a comment |

---

## Production Deployment

Authenticate with Google Cloud / Firebase:
```bash
firebase login
firebase use --add
```

Deploy functions and Firestore rules:
```bash
npm run deploy
```

For complete step-by-step instructions, authentication patterns, and web app integrations, see the [Firebase Server Guide](../../docs/FIREBASE_SERVER_GUIDE.md).
