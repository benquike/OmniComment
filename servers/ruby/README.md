# OmniComment Ruby Persistence Server

Production-ready backend for persisting OmniComment threads, replies, and text anchors in **Ruby**, offering a **zero-dependency standard library server**, **Sinatra / Puma** production app, and **Ruby on Rails** drop-in controller.

---

## Features

- **Zero External Dependencies Option**: [`server.rb`](server.rb) runs immediately using Ruby's built-in `WEBrick` and `json` libraries.
- **Sinatra / Puma Production Mode**: [`app.rb`](app.rb) and [`config.ru`](config.ru) for high-performance multi-threaded Puma deployments.
- **Ruby on Rails 7 & 8 Controller**: Pre-built [`rails/comments_controller.rb`](rails/comments_controller.rb) with strong parameters.
- **Concurrency-Safe Persistence**: Mutex-synchronized memory caching with atomic filesystem updates (`comments.json`).
- **CORS Configured**: Plug-and-play with `@omnicomment/web-plugin`.

---

## Directory Structure

```text
servers/ruby/
├── server.rb                 # Zero-dependency WEBrick REST server
├── app.rb                   # Sinatra REST API application
├── config.ru                # Rackup configuration for Puma / Unicorn
├── Gemfile                  # Bundler dependencies (Sinatra, Puma, Rack-CORS)
├── Dockerfile               # Container build
├── README.md                # Quickstart documentation
└── rails/
    └── comments_controller.rb  # Drop-in Rails 7/8 API controller
```

---

## Quickstart

### Option A: Zero-Dependency Standalone (Immediate Run)
Runs directly using standard Ruby:
```bash
cd servers/ruby
ruby server.rb
```
Server listens on `http://localhost:8000`.

---

### Option B: Sinatra with Puma
```bash
cd servers/ruby
bundle install
bundle exec rackup -p 8000
```

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

## Ruby on Rails Integration

1. Copy [`rails/comments_controller.rb`](rails/comments_controller.rb) to `app/controllers/api/comments_controller.rb`.
2. Register routes in `config/routes.rb`:
```ruby
namespace :api do
  resources :documents, only: [] do
    resources :comments, only: [:index, :show, :create, :update, :destroy] do
      post :replies, on: :member, to: 'comments#add_reply'
    end
  end
end
```

---

## Running with Docker

```bash
docker build -t omnicomment-ruby .
docker run -p 8000:8000 -v $(pwd)/data:/data omnicomment-ruby
```

---

## Client Integration (`@omnicomment/web-plugin`)

```typescript
import { initOmniComment } from '@omnicomment/web-plugin';

initOmniComment({
  target: '#article-content',
  documentId: 'architecture-guide',
  storage: {
    type: 'rest',
    endpoint: 'http://localhost:8000/api/documents/architecture-guide/comments'
  }
});
```
