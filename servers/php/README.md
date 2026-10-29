# OmniComment PHP Persistence Server

Lightweight, modern **PHP 8.2+** REST API for persisting OmniComment threads, replies, and text anchors using **PDO SQLite** or **Laravel**.

---

## Features

- **Standalone Zero-Dependency Option**: Run immediately with PHP's built-in web server (`php -S`) or Nginx/Apache + PHP-FPM.
- **Auto-Migrating SQLite Database**: Automatically creates schema, foreign keys, and indexes on first boot.
- **Laravel 10 / 11 Drop-in Controller**: Pre-built [`OmniCommentController`](laravel/OmniCommentController.php) ready to register in `routes/api.php`.
- **CORS Configured**: Ready to accept cross-origin requests from `@omnicomment/web-plugin`.

---

## Quickstart (Standalone PHP)

### 1. Launch Built-in Web Server
```bash
cd servers/php
php -S 0.0.0.0:8000 -t public
```

The server listens on `http://localhost:8000`.

---

## Running with Docker

```bash
docker build -t omnicomment-php .
docker run -p 8000:8000 -v $(pwd)/data:/app/data omnicomment-php
```

---

## Laravel Integration

1. Copy `servers/php/laravel/OmniCommentController.php` to your Laravel app's `app/Http/Controllers/`.
2. Add routes to `routes/api.php`:
```php
use App\Http\Controllers\OmniCommentController;

Route::prefix('documents/{docId}/comments')->group(function () {
    Route::get('/', [OmniCommentController::class, 'index']);
    Route::post('/', [OmniCommentController::class, 'store']);
    Route::get('{commentId}', [OmniCommentController::class, 'show']);
    Route::patch('{commentId}', [OmniCommentController::class, 'update']);
    Route::delete('{commentId}', [OmniCommentController::class, 'destroy']);
    Route::post('{commentId}/replies', [OmniCommentController::class, 'storeReply']);
});
```

---

## Client Integration (`@omnicomment/web-plugin`)

```typescript
import { initOmniComment } from '@omnicomment/web-plugin';

initOmniComment({
  target: '#article-content',
  documentId: 'api-reference',
  storage: {
    type: 'rest',
    endpoint: 'http://localhost:8000/api/documents/api-reference/comments'
  }
});
```
