"""OmniComment Python FastAPI Persistence Server.

High-performance asynchronous REST API for persisting OmniComment threads,
replies, resolutions, and reactions with SQLite storage and Pydantic validation.
"""

from __future__ import annotations

import json
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import aiosqlite
from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

DATABASE_PATH = os.environ.get("OMNICOMMENT_DB_PATH", "comments.db")


# ------------------------------------------------------------------------------
# Pydantic Schemas (W3C Web Annotation & OmniComment Compatible)
# ------------------------------------------------------------------------------

class CamelModel(BaseModel):
    """Base model enforcing camelCase serialization for browser SDK compatibility."""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class CommentAnchor(CamelModel):
    """Exact position and text coordinates of an anchored comment in a document."""
    text: str = Field(..., min_length=1, description="Highlighted text content")
    start_line: int = Field(..., ge=0, description="Start line number (0-based)")
    start_char: int = Field(..., ge=0, description="Start character offset")
    end_line: int = Field(..., ge=0, description="End line number (0-based)")
    end_char: int = Field(..., ge=0, description="End character offset")


class CommentReply(CamelModel):
    """A response or discussion message inside a comment thread."""
    id: str
    content: str
    author: str
    created_at: str
    updated_at: Optional[str] = None
    thumbs_up: List[str] = Field(default_factory=list)


class OmniComment(CamelModel):
    """Top-level comment thread entity."""
    id: str
    document_id: str
    anchor: CommentAnchor
    content: str
    author: str
    created_at: str
    updated_at: str
    resolved: bool = False
    orphaned: bool = False
    thumbs_up: List[str] = Field(default_factory=list)
    replies: List[CommentReply] = Field(default_factory=list)


class CreateCommentDto(CamelModel):
    """Payload for creating a new comment thread."""
    id: Optional[str] = None
    anchor: CommentAnchor
    content: str = Field(..., min_length=1, max_length=10000)
    author: str = Field(..., min_length=1, max_length=100)


class UpdateCommentDto(CamelModel):
    """Payload for editing comment content, status, or reactions."""
    content: Optional[str] = Field(None, min_length=1, max_length=10000)
    resolved: Optional[bool] = None
    orphaned: Optional[bool] = None
    thumbs_up: Optional[List[str]] = None


class AddReplyDto(CamelModel):
    """Payload for appending a response to an existing thread."""
    id: Optional[str] = None
    content: str = Field(..., min_length=1, max_length=10000)
    author: str = Field(..., min_length=1, max_length=100)


# ------------------------------------------------------------------------------
# Database Lifecycle & Initialization (HC002, HC004)
# ------------------------------------------------------------------------------

# Invariant: Database tables and indexes must exist prior to processing requests.
# Why: Prevents 500 query failures on fresh service boot.
# Example: Schema creates `comments` and `replies` relational tables with foreign key indexing.
CREATE_COMMENTS_TABLE_SQL = """
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
CREATE INDEX IF NOT EXISTS idx_comments_doc_id ON comments(document_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at);

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
CREATE INDEX IF NOT EXISTS idx_replies_comment_id ON replies(comment_id);
"""


async def init_db() -> None:
    """Initializes the SQLite schema."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.executescript(CREATE_COMMENTS_TABLE_SQL)
        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manages application startup and shutdown lifecycle."""
    await init_db()
    yield


app = FastAPI(
    title="OmniComment Persistence Server (FastAPI)",
    description="Universal in-context comment persistence API for web apps and editors",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_current_iso_time() -> str:
    """Generates an ISO 8601 UTC timestamp."""
    return datetime.now(timezone.utc).isoformat()


# ------------------------------------------------------------------------------
# Data Mapping Helpers
# ------------------------------------------------------------------------------

def map_comment_row(row: Any, replies: List[CommentReply]) -> OmniComment:
    """Constructs an OmniComment instance from a SQLite row tuple."""
    return OmniComment(
        id=row[0],
        document_id=row[1],
        anchor=CommentAnchor(**json.loads(row[2])),
        content=row[3],
        author=row[4],
        created_at=row[5],
        updated_at=row[6],
        resolved=bool(row[7]),
        orphaned=bool(row[8]),
        thumbs_up=json.loads(row[9]),
        replies=replies,
    )


def map_reply_row(row: Any) -> CommentReply:
    """Constructs a CommentReply instance from a SQLite row tuple."""
    return CommentReply(
        id=row[0],
        content=row[1],
        author=row[2],
        created_at=row[3],
        updated_at=row[4],
        thumbs_up=json.loads(row[5]),
    )


# ------------------------------------------------------------------------------
# REST API Endpoints
# ------------------------------------------------------------------------------

@app.get("/health", tags=["System"])
async def health_check() -> Dict[str, Any]:
    """Health check endpoint for container orchestrators."""
    return {
        "status": "ok",
        "service": "omnicomment-python-fastapi",
        "timestamp": get_current_iso_time(),
    }


@app.get("/api/documents/{doc_id}/comments", response_model=Dict[str, Any], tags=["Comments"])
async def list_comments(
    doc_id: str,
    include_resolved: bool = Query(True, alias="includeResolved"),
    sort: str = Query("asc", regex="^(asc|desc)$"),
) -> Dict[str, Any]:
    """Retrieves all comments associated with a given document ID."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        query = "SELECT id, document_id, anchor_json, content, author, created_at, updated_at, resolved, orphaned, thumbs_up_json FROM comments WHERE document_id = ?"
        params: List[Any] = [doc_id]

        if not include_resolved:
            query += " AND resolved = 0"

        query += f" ORDER BY created_at {sort.upper()}"

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()

        comments: List[OmniComment] = []
        for row in rows:
            comment_id = row[0]
            reply_cursor = await db.execute(
                "SELECT id, content, author, created_at, updated_at, thumbs_up_json FROM replies WHERE comment_id = ? ORDER BY created_at ASC",
                (comment_id,),
            )
            reply_rows = await reply_cursor.fetchall()
            replies = [map_reply_row(r) for r in reply_rows]
            comments.append(map_comment_row(row, replies))

        return {
            "success": True,
            "count": len(comments),
            "comments": [c.model_dump(by_alias=True) for c in comments],
        }


@app.get("/api/documents/{doc_id}/comments/{comment_id}", response_model=Dict[str, Any], tags=["Comments"])
async def get_comment(doc_id: str, comment_id: str) -> Dict[str, Any]:
    """Retrieves a single comment thread by ID."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            "SELECT id, document_id, anchor_json, content, author, created_at, updated_at, resolved, orphaned, thumbs_up_json FROM comments WHERE id = ? AND document_id = ?",
            (comment_id, doc_id),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")

        reply_cursor = await db.execute(
            "SELECT id, content, author, created_at, updated_at, thumbs_up_json FROM replies WHERE comment_id = ? ORDER BY created_at ASC",
            (comment_id,),
        )
        reply_rows = await reply_cursor.fetchall()
        replies = [map_reply_row(r) for r in reply_rows]
        comment = map_comment_row(row, replies)

        return {"success": True, "comment": comment.model_dump(by_alias=True)}


@app.post("/api/documents/{doc_id}/comments", status_code=status.HTTP_201_CREATED, tags=["Comments"])
async def create_comment(doc_id: str, payload: CreateCommentDto) -> Dict[str, Any]:
    """Creates a new comment thread anchored to a text selection."""
    now = get_current_iso_time()
    comment_id = payload.id if payload.id and payload.id.strip() else f"comment-{uuid.uuid4().hex[:12]}"

    new_comment = OmniComment(
        id=comment_id,
        document_id=doc_id,
        anchor=payload.anchor,
        content=payload.content,
        author=payload.author,
        created_at=now,
        updated_at=now,
        resolved=False,
        orphaned=False,
        thumbs_up=[],
        replies=[],
    )

    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            """
            INSERT INTO comments (id, document_id, anchor_json, content, author, created_at, updated_at, resolved, orphaned, thumbs_up_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_comment.id,
                new_comment.document_id,
                json.dumps(new_comment.anchor.model_dump(by_alias=True)),
                new_comment.content,
                new_comment.author,
                new_comment.created_at,
                new_comment.updated_at,
                int(new_comment.resolved),
                int(new_comment.orphaned),
                json.dumps(new_comment.thumbs_up),
            ),
        )
        await db.commit()

    return {"success": True, "comment": new_comment.model_dump(by_alias=True)}


@app.patch("/api/documents/{doc_id}/comments/{comment_id}", tags=["Comments"])
async def update_comment(doc_id: str, comment_id: str, payload: UpdateCommentDto) -> Dict[str, Any]:
    """Updates comment content, resolved state, or thumbs-up reactions."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            "SELECT id, document_id, anchor_json, content, author, created_at, updated_at, resolved, orphaned, thumbs_up_json FROM comments WHERE id = ? AND document_id = ?",
            (comment_id, doc_id),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")

        updates: List[str] = ["updated_at = ?"]
        params: List[Any] = [get_current_iso_time()]

        if payload.content is not None:
            updates.append("content = ?")
            params.append(payload.content)
        if payload.resolved is not None:
            updates.append("resolved = ?")
            params.append(int(payload.resolved))
        if payload.orphaned is not None:
            updates.append("orphaned = ?")
            params.append(int(payload.orphaned))
        if payload.thumbs_up is not None:
            updates.append("thumbs_up_json = ?")
            params.append(json.dumps(payload.thumbs_up))

        params.extend([comment_id, doc_id])
        sql = f"UPDATE comments SET {', '.join(updates)} WHERE id = ? AND document_id = ?"
        await db.execute(sql, params)
        await db.commit()

    return await get_comment(doc_id, comment_id)


@app.post("/api/documents/{doc_id}/comments/{comment_id}/replies", status_code=status.HTTP_201_CREATED, tags=["Comments"])
async def add_reply(doc_id: str, comment_id: str, payload: AddReplyDto) -> Dict[str, Any]:
    """Appends a new reply to an existing comment thread."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Verify parent comment exists
        cursor = await db.execute(
            "SELECT id FROM comments WHERE id = ? AND document_id = ?",
            (comment_id, doc_id),
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment thread not found")

        reply_id = payload.id if payload.id and payload.id.strip() else f"reply-{uuid.uuid4().hex[:12]}"
        now = get_current_iso_time()

        new_reply = CommentReply(
            id=reply_id,
            content=payload.content,
            author=payload.author,
            created_at=now,
            updated_at=now,
            thumbs_up=[],
        )

        await db.execute(
            """
            INSERT INTO replies (id, comment_id, content, author, created_at, updated_at, thumbs_up_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_reply.id,
                comment_id,
                new_reply.content,
                new_reply.author,
                new_reply.created_at,
                new_reply.updated_at,
                json.dumps(new_reply.thumbs_up),
            ),
        )
        # Update thread's updated_at timestamp
        await db.execute("UPDATE comments SET updated_at = ? WHERE id = ?", (now, comment_id))
        await db.commit()

    return {"success": True, "reply": new_reply.model_dump(by_alias=True)}


@app.delete("/api/documents/{doc_id}/comments/{comment_id}", tags=["Comments"])
async def delete_comment(doc_id: str, comment_id: str) -> Dict[str, Any]:
    """Deletes a comment thread and cascades to all its replies."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            "DELETE FROM comments WHERE id = ? AND document_id = ?",
            (comment_id, doc_id),
        )
        await db.execute("DELETE FROM replies WHERE comment_id = ?", (comment_id,))
        await db.commit()

        if cursor.rowcount == 0:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")

    return {"success": True, "message": f"Comment {comment_id} deleted successfully"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
