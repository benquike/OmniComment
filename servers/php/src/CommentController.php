<?php

declare(strict_types=1);

namespace OmniComment;

use PDO;

class CommentController
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::getConnection();
    }

    public function health(): void
    {
        $this->json([
            'status' => 'ok',
            'service' => 'omnicomment-php-server',
            'timestamp' => gmdate('Y-m-d\TH:i:s\Z'),
        ]);
    }

    public function listComments(string $docId): void
    {
        $includeResolved = ($_GET['includeResolved'] ?? 'true') !== 'false';
        $sort = strtolower($_GET['sort'] ?? 'asc') === 'desc' ? 'DESC' : 'ASC';

        $sql = "SELECT * FROM comments WHERE document_id = :docId";
        if (!$includeResolved) {
            $sql .= " AND resolved = 0";
        }
        $sql .= " ORDER BY created_at {$sort}";

        $stmt = $this->db->prepare($sql);
        $stmt->execute([':docId' => $docId]);
        $rows = $stmt->fetchAll();

        $comments = [];
        foreach ($rows as $row) {
            $comments[] = $this->formatCommentWithReplies($row);
        }

        $this->json([
            'success' => true,
            'count' => count($comments),
            'comments' => $comments,
        ]);
    }

    public function getComment(string $docId, string $commentId): void
    {
        $stmt = $this->db->prepare("SELECT * FROM comments WHERE id = :id AND document_id = :docId");
        $stmt->execute([':id' => $commentId, ':docId' => $docId]);
        $row = $stmt->fetch();

        if (!$row) {
            $this->json(['success' => false, 'error' => 'Comment not found'], 404);
            return;
        }

        $this->json([
            'success' => true,
            'comment' => $this->formatCommentWithReplies($row),
        ]);
    }

    public function createComment(string $docId, array $data): void
    {
        if (empty($data['content']) || empty($data['author']) || empty($data['anchor'])) {
            $this->json(['success' => false, 'error' => 'content, author, and anchor are required'], 400);
            return;
        }

        $now = gmdate('Y-m-d\TH:i:s\Z');
        $commentId = !empty($data['id']) ? (string)$data['id'] : 'comment-' . substr(bin2hex(random_bytes(8)), 0, 12);

        $stmt = $this->db->prepare("
            INSERT INTO comments (id, document_id, anchor_json, content, author, created_at, updated_at, resolved, orphaned, thumbs_up_json)
            VALUES (:id, :document_id, :anchor_json, :content, :author, :created_at, :updated_at, 0, 0, '[]')
        ");

        $stmt->execute([
            ':id' => $commentId,
            ':document_id' => $docId,
            ':anchor_json' => json_encode($data['anchor']),
            ':content' => $data['content'],
            ':author' => $data['author'],
            ':created_at' => $now,
            ':updated_at' => $now,
        ]);

        $this->getComment($docId, $commentId);
    }

    public function updateComment(string $docId, string $commentId, array $patch): void
    {
        $stmt = $this->db->prepare("SELECT id FROM comments WHERE id = :id AND document_id = :docId");
        $stmt->execute([':id' => $commentId, ':docId' => $docId]);
        if (!$stmt->fetch()) {
            $this->json(['success' => false, 'error' => 'Comment not found'], 404);
            return;
        }

        $fields = ['updated_at = :updated_at'];
        $params = [
            ':id' => $commentId,
            ':docId' => $docId,
            ':updated_at' => gmdate('Y-m-d\TH:i:s\Z'),
        ];

        if (isset($patch['content'])) {
            $fields[] = 'content = :content';
            $params[':content'] = (string)$patch['content'];
        }
        if (isset($patch['resolved'])) {
            $fields[] = 'resolved = :resolved';
            $params[':resolved'] = $patch['resolved'] ? 1 : 0;
        }
        if (isset($patch['orphaned'])) {
            $fields[] = 'orphaned = :orphaned';
            $params[':orphaned'] = $patch['orphaned'] ? 1 : 0;
        }
        if (isset($patch['thumbsUp']) && is_array($patch['thumbsUp'])) {
            $fields[] = 'thumbs_up_json = :thumbsUp';
            $params[':thumbsUp'] = json_encode($patch['thumbsUp']);
        }

        $sql = "UPDATE comments SET " . implode(', ', $fields) . " WHERE id = :id AND document_id = :docId";
        $updateStmt = $this->db->prepare($sql);
        $updateStmt->execute($params);

        $this->getComment($docId, $commentId);
    }

    public function addReply(string $docId, string $commentId, array $data): void
    {
        if (empty($data['content']) || empty($data['author'])) {
            $this->json(['success' => false, 'error' => 'content and author are required'], 400);
            return;
        }

        $stmt = $this->db->prepare("SELECT id FROM comments WHERE id = :id AND document_id = :docId");
        $stmt->execute([':id' => $commentId, ':docId' => $docId]);
        if (!$stmt->fetch()) {
            $this->json(['success' => false, 'error' => 'Comment thread not found'], 404);
            return;
        }

        $now = gmdate('Y-m-d\TH:i:s\Z');
        $replyId = !empty($data['id']) ? (string)$data['id'] : 'reply-' . substr(bin2hex(random_bytes(8)), 0, 12);

        $replyStmt = $this->db->prepare("
            INSERT INTO replies (id, comment_id, content, author, created_at, updated_at, thumbs_up_json)
            VALUES (:id, :comment_id, :content, :author, :created_at, :updated_at, '[]')
        ");
        $replyStmt->execute([
            ':id' => $replyId,
            ':comment_id' => $commentId,
            ':content' => $data['content'],
            ':author' => $data['author'],
            ':created_at' => $now,
            ':updated_at' => $now,
        ]);

        // Touch comment updated_at
        $touchStmt = $this->db->prepare("UPDATE comments SET updated_at = :updated_at WHERE id = :id");
        $touchStmt->execute([':updated_at' => $now, ':id' => $commentId]);

        $this->json([
            'success' => true,
            'reply' => [
                'id' => $replyId,
                'content' => $data['content'],
                'author' => $data['author'],
                'createdAt' => $now,
                'updatedAt' => $now,
                'thumbsUp' => [],
            ],
        ], 201);
    }

    public function deleteComment(string $docId, string $commentId): void
    {
        $stmt = $this->db->prepare("DELETE FROM comments WHERE id = :id AND document_id = :docId");
        $stmt->execute([':id' => $commentId, ':docId' => $docId]);

        if ($stmt->rowCount() === 0) {
            $this->json(['success' => false, 'error' => 'Comment not found'], 404);
            return;
        }

        // Delete cascade replies
        $delReplies = $this->db->prepare("DELETE FROM replies WHERE comment_id = :commentId");
        $delReplies->execute([':commentId' => $commentId]);

        $this->json([
            'success' => true,
            'message' => "Comment {$commentId} deleted successfully",
        ]);
    }

    private function formatCommentWithReplies(array $row): array
    {
        $stmt = $this->db->prepare("SELECT * FROM replies WHERE comment_id = :commentId ORDER BY created_at ASC");
        $stmt->execute([':commentId' => $row['id']]);
        $replyRows = $stmt->fetchAll();

        $replies = [];
        foreach ($replyRows as $r) {
            $replies[] = [
                'id' => $r['id'],
                'content' => $r['content'],
                'author' => $r['author'],
                'createdAt' => $r['created_at'],
                'updatedAt' => $r['updated_at'],
                'thumbsUp' => json_decode($r['thumbs_up_json'], true) ?: [],
            ];
        }

        return [
            'id' => $row['id'],
            'documentId' => $row['document_id'],
            'anchor' => json_decode($row['anchor_json'], true) ?: [],
            'content' => $row['content'],
            'author' => $row['author'],
            'createdAt' => $row['created_at'],
            'updatedAt' => $row['updated_at'],
            'resolved' => (bool)$row['resolved'],
            'orphaned' => (bool)$row['orphaned'],
            'thumbsUp' => json_decode($row['thumbs_up_json'], true) ?: [],
            'replies' => $replies,
        ];
    }

    private function json(array $data, int $statusCode = 200): void
    {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}
