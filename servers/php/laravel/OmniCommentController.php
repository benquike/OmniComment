<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * OmniComment Laravel Controller
 * 
 * Drop-in controller for Laravel 10 / 11 applications.
 * 
 * Registration in routes/api.php:
 * 
 * Route::prefix('documents/{docId}/comments')->group(function () {
 *     Route::get('/', [OmniCommentController::class, 'index']);
 *     Route::post('/', [OmniCommentController::class, 'store']);
 *     Route::get('{commentId}', [OmniCommentController::class, 'show']);
 *     Route::patch('{commentId}', [OmniCommentController::class, 'update']);
 *     Route::delete('{commentId}', [OmniCommentController::class, 'destroy']);
 *     Route::post('{commentId}/replies', [OmniCommentController::class, 'storeReply']);
 * });
 */
class OmniCommentController extends Controller
{
    public function index(Request $request, string $docId): JsonResponse
    {
        $includeResolved = filter_var($request->query('includeResolved', true), FILTER_VALIDATE_BOOLEAN);
        $sort = strtolower($request->query('sort', 'asc')) === 'desc' ? 'desc' : 'asc';

        $query = DB::table('comments')->where('document_id', $docId);
        if (!$includeResolved) {
            $query->where('resolved', false);
        }
        $comments = $query->orderBy('created_at', $sort)->get();

        $commentIds = $comments->pluck('id');
        $replies = DB::table('replies')->whereIn('comment_id', $commentIds)->orderBy('created_at', 'asc')->get()->groupBy('comment_id');

        $formatted = $comments->map(function ($c) use ($replies) {
            return [
                'id' => $c->id,
                'documentId' => $c->document_id,
                'anchor' => json_decode($c->anchor_json, true),
                'content' => $c->content,
                'author' => $c->author,
                'createdAt' => $c->created_at,
                'updatedAt' => $c->updated_at,
                'resolved' => (bool)$c->resolved,
                'orphaned' => (bool)$c->orphaned,
                'thumbsUp' => json_decode($c->thumbs_up_json ?? '[]', true),
                'replies' => ($replies->get($c->id) ?? collect())->map(function ($r) {
                    return [
                        'id' => $r->id,
                        'content' => $r->content,
                        'author' => $r->author,
                        'createdAt' => $r->created_at,
                        'updatedAt' => $r->updated_at,
                        'thumbsUp' => json_decode($r->thumbs_up_json ?? '[]', true),
                    ];
                })->values(),
            ];
        });

        return response()->json([
            'success' => true,
            'count' => $formatted->count(),
            'comments' => $formatted,
        ]);
    }

    public function store(Request $request, string $docId): JsonResponse
    {
        $validated = $request->validate([
            'content' => 'required|string|max:10000',
            'author' => 'required|string|max:100',
            'anchor' => 'required|array',
            'anchor.text' => 'required|string',
            'anchor.startLine' => 'required|integer',
            'anchor.startChar' => 'required|integer',
            'anchor.endLine' => 'required|integer',
            'anchor.endChar' => 'required|integer',
        ]);

        $now = now()->toISOString();
        $id = $request->input('id', 'comment-' . Str::random(12));

        DB::table('comments')->insert([
            'id' => $id,
            'document_id' => $docId,
            'anchor_json' => json_encode($validated['anchor']),
            'content' => $validated['content'],
            'author' => $validated['author'],
            'created_at' => $now,
            'updated_at' => $now,
            'resolved' => false,
            'orphaned' => false,
            'thumbs_up_json' => '[]',
        ]);

        return response()->json([
            'success' => true,
            'comment' => [
                'id' => $id,
                'documentId' => $docId,
                'anchor' => $validated['anchor'],
                'content' => $validated['content'],
                'author' => $validated['author'],
                'createdAt' => $now,
                'updatedAt' => $now,
                'resolved' => false,
                'orphaned' => false,
                'thumbsUp' => [],
                'replies' => [],
            ],
        ], 201);
    }

    public function show(string $docId, string $commentId): JsonResponse
    {
        $comment = DB::table('comments')->where('id', $commentId)->where('document_id', $docId)->first();
        if (!$comment) {
            return response()->json(['success' => false, 'error' => 'Comment not found'], 404);
        }

        $replies = DB::table('replies')->where('comment_id', $commentId)->orderBy('created_at', 'asc')->get();

        return response()->json([
            'success' => true,
            'comment' => [
                'id' => $comment->id,
                'documentId' => $comment->document_id,
                'anchor' => json_decode($comment->anchor_json, true),
                'content' => $comment->content,
                'author' => $comment->author,
                'createdAt' => $comment->created_at,
                'updatedAt' => $comment->updated_at,
                'resolved' => (bool)$comment->resolved,
                'orphaned' => (bool)$comment->orphaned,
                'thumbsUp' => json_decode($comment->thumbs_up_json ?? '[]', true),
                'replies' => $replies->map(fn($r) => [
                    'id' => $r->id,
                    'content' => $r->content,
                    'author' => $r->author,
                    'createdAt' => $r->created_at,
                    'updatedAt' => $r->updated_at,
                    'thumbsUp' => json_decode($r->thumbs_up_json ?? '[]', true),
                ]),
            ],
        ]);
    }

    public function update(Request $request, string $docId, string $commentId): JsonResponse
    {
        $comment = DB::table('comments')->where('id', $commentId)->where('document_id', $docId)->first();
        if (!$comment) {
            return response()->json(['success' => false, 'error' => 'Comment not found'], 404);
        }

        $updates = ['updated_at' => now()->toISOString()];
        if ($request->has('content')) {
            $updates['content'] = $request->input('content');
        }
        if ($request->has('resolved')) {
            $updates['resolved'] = (bool)$request->input('resolved');
        }
        if ($request->has('orphaned')) {
            $updates['orphaned'] = (bool)$request->input('orphaned');
        }
        if ($request->has('thumbsUp')) {
            $updates['thumbs_up_json'] = json_encode($request->input('thumbsUp'));
        }

        DB::table('comments')->where('id', $commentId)->update($updates);

        return $this->show($docId, $commentId);
    }

    public function storeReply(Request $request, string $docId, string $commentId): JsonResponse
    {
        $validated = $request->validate([
            'content' => 'required|string|max:10000',
            'author' => 'required|string|max:100',
        ]);

        $comment = DB::table('comments')->where('id', $commentId)->where('document_id', $docId)->first();
        if (!$comment) {
            return response()->json(['success' => false, 'error' => 'Comment thread not found'], 404);
        }

        $now = now()->toISOString();
        $replyId = $request->input('id', 'reply-' . Str::random(12));

        DB::table('replies')->insert([
            'id' => $replyId,
            'comment_id' => $commentId,
            'content' => $validated['content'],
            'author' => $validated['author'],
            'created_at' => $now,
            'updated_at' => $now,
            'thumbs_up_json' => '[]',
        ]);

        DB::table('comments')->where('id', $commentId)->update(['updated_at' => $now]);

        return response()->json([
            'success' => true,
            'reply' => [
                'id' => $replyId,
                'content' => $validated['content'],
                'author' => $validated['author'],
                'createdAt' => $now,
                'updatedAt' => $now,
                'thumbsUp' => [],
            ],
        ], 201);
    }

    public function destroy(string $docId, string $commentId): JsonResponse
    {
        $deleted = DB::table('comments')->where('id', $commentId)->where('document_id', $docId)->delete();
        if (!$deleted) {
            return response()->json(['success' => false, 'error' => 'Comment not found'], 404);
        }
        DB::table('replies')->where('comment_id', $commentId)->delete();

        return response()->json([
            'success' => true,
            'message' => "Comment {$commentId} deleted successfully",
        ]);
    }
}
