import * as fs from 'fs';
import * as path from 'path';
import type { Comment } from '../core/types';

/**
 * Extension-managed comment storage, kept outside the commented files.
 *
 * One store per workspace lives in VS Code's private extension storage (context.storageUri), so
 * comments never touch the document (no dirty state, no git noise). Each file's comment array is
 * stored as one JSON row keyed by the file's URI string.
 */
export interface ICommentStore {
  readonly kind: 'sqlite' | 'json';
  readonly location: string;
  load(fileKey: string): Comment[];
  save(fileKey: string, comments: Comment[]): void;
  rename(oldKey: string, newKey: string): void;
  close(): void;
}

// Minimal typing for the built-in node:sqlite module (Node 22.5+; VS Code 1.9x+ ships Node 22/24).
interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const SCHEMA_VERSION = 1;

// Invariant: Comment arrays round-trip through the store as JSON; malformed rows read as empty.
// Why: A corrupt row must never take down highlighting for the whole workspace.
// Example: parseStoredComments('not json') => [].
export function parseStoredComments(json: unknown): Comment[] {
  if (typeof json !== 'string' || !json) {
    return [];
  }
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as Comment[]) : [];
  } catch {
    return [];
  }
}

class SqliteCommentStore implements ICommentStore {
  readonly kind = 'sqlite' as const;
  private readonly db: SqliteDatabase;

  constructor(readonly location: string, DatabaseSync: new (file: string) => SqliteDatabase) {
    this.db = new DatabaseSync(location);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS file_comments (
        file_key   TEXT PRIMARY KEY,
        comments   TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.db
      .prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)')
      .run('schema_version', String(SCHEMA_VERSION));
  }

  load(fileKey: string): Comment[] {
    const row = this.db.prepare('SELECT comments FROM file_comments WHERE file_key = ?').get(fileKey);
    return parseStoredComments(row?.comments);
  }

  save(fileKey: string, comments: Comment[]): void {
    if (comments.length === 0) {
      this.db.prepare('DELETE FROM file_comments WHERE file_key = ?').run(fileKey);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO file_comments (file_key, comments, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(file_key) DO UPDATE SET comments = excluded.comments, updated_at = excluded.updated_at`
      )
      .run(fileKey, JSON.stringify(comments), new Date().toISOString());
  }

  rename(oldKey: string, newKey: string): void {
    this.db.prepare('UPDATE OR REPLACE file_comments SET file_key = ? WHERE file_key = ?').run(newKey, oldKey);
  }

  close(): void {
    this.db.close();
  }
}

// Invariant: Same contract as the SQLite store, persisted as one JSON file.
// Why: Fallback for VS Code builds whose Node runtime lacks node:sqlite (older than ~1.9x).
// Example: { "file:///w/notes.txt": [ ...comments ] } in omnicomment.json.
class JsonCommentStore implements ICommentStore {
  readonly kind = 'json' as const;
  private data: Record<string, Comment[]>;

  constructor(readonly location: string) {
    try {
      this.data = JSON.parse(fs.readFileSync(location, 'utf8'));
    } catch {
      this.data = {};
    }
  }

  load(fileKey: string): Comment[] {
    return Array.isArray(this.data[fileKey]) ? this.data[fileKey] : [];
  }

  save(fileKey: string, comments: Comment[]): void {
    if (comments.length === 0) {
      delete this.data[fileKey];
    } else {
      this.data[fileKey] = comments;
    }
    this.flush();
  }

  rename(oldKey: string, newKey: string): void {
    if (!(oldKey in this.data)) {
      return;
    }
    this.data[newKey] = this.data[oldKey];
    delete this.data[oldKey];
    this.flush();
  }

  close(): void {
    // Writes are flushed eagerly
  }

  private flush(): void {
    const tmp = `${this.location}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.location);
  }
}

// Invariant: Opens the workspace comment store in `storageDir`, preferring SQLite.
// Why: node:sqlite needs no native module, so the VSIX stays platform-independent; JSON is the
//      fallback when the runtime lacks it.
// Example: openCommentStore('/home/u/.config/Code/User/workspaceStorage/abc/benquike.omnicomment').
export function openCommentStore(storageDir: string): ICommentStore {
  fs.mkdirSync(storageDir, { recursive: true });
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require('node:sqlite');
    return new SqliteCommentStore(path.join(storageDir, 'omnicomment.db'), DatabaseSync);
  } catch {
    return new JsonCommentStore(path.join(storageDir, 'omnicomment.json'));
  }
}
