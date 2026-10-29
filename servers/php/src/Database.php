<?php

declare(strict_types=1);

namespace OmniComment;

use PDO;

class Database
{
    private static ?PDO $pdo = null;

    public static function getConnection(): PDO
    {
        if (self::$pdo === null) {
            $dbPath = getenv('OMNICOMMENT_DB_PATH') ?: __DIR__ . '/../data/comments.sqlite';
            $dbDir = dirname($dbPath);
            if (!is_dir($dbDir)) {
                mkdir($dbDir, 0755, true);
            }

            self::$pdo = new PDO("sqlite:{$dbPath}", null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);

            self::initSchema(self::$pdo);
        }

        return self::$pdo;
    }

    private static function initSchema(PDO $pdo): void
    {
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS comments (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                anchor_json TEXT NOT NULL,
                content TEXT NOT NULL,
                author TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                resolved INTEGER NOT NULL DEFAULT 0,
                orphaned INTEGER NOT NULL DEFAULT 0,
                thumbs_up_json TEXT NOT NULL DEFAULT '[]'
            );
            CREATE INDEX IF NOT EXISTS idx_comments_doc ON comments(document_id);
            CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at);

            CREATE TABLE IF NOT EXISTS replies (
                id TEXT PRIMARY KEY,
                comment_id TEXT NOT NULL,
                content TEXT NOT NULL,
                author TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT,
                thumbs_up_json TEXT NOT NULL DEFAULT '[]',
                FOREIGN KEY(comment_id) REFERENCES comments(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_replies_comment ON replies(comment_id);
        ");
    }
}
