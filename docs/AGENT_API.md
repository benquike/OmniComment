# OmniComment AI Agent & Automation API

OmniComment provides first-class programmatic interfaces designed specifically for autonomous AI agents, language models (LLMs), continuous integration (CI) bots, and review tooling.

Rather than forcing AI assistants to generate diffs or inject arbitrary text directly into documents, agents can interact with the human author through native inline comment threads—proposing changes, asking clarifying questions, answering reviewer inquiries, and marking review findings as resolved once addressed.

---

## Table of Contents

1. [Overview & Agent Interaction Loop](#overview--agent-interaction-loop)
2. [VS Code Command API](#vs-code-command-api)
   - [`omnicomment.agent.getComments`](#1-retrieve-comments-omnicommentagentgetcomments)
   - [`omnicomment.agent.postComment`](#2-post-a-comment-omnicommentagentpostcomment)
   - [`omnicomment.agent.replyComment`](#3-reply-to-a-thread-omnicommentagentreplycomment)
   - [`omnicomment.agent.resolveComment`](#4-resolve-or-reopen-a-thread-omnicommentagentresolvecomment)
   - [`omnicomment.agent.deleteComment`](#5-delete-a-comment-omnicommentagentdeletecomment)
3. [Model Context Protocol (MCP) Toolset](#model-context-protocol-mcp-toolset)
4. [Prompt Context Injection (`exportContextForLLM`)](#prompt-context-injection-exportcontextforllm)
5. [End-to-End Code Examples](#end-to-end-code-examples)
   - [TypeScript (VS Code Extension / Extension Host)](#typescript-example)
   - [Python (MCP / Headless Automation)](#python-mcp-agent-example)

---

## Overview & Agent Interaction Loop

```
  +------------------+                    +---------------------+
  |                  |   1. getComments   |                     |
  |     AI Agent     | -----------------> |     OmniComment     |
  |  (LLM / Reviewer)| <----------------- |     Controller      |
  |                  |   Active Threads   |                     |
  |                  |                    +---------------------+
  |                  |                               |
  |                  |   2. postComment (Finding)    |
  |                  | ----------------------------> | [Inline Widget Created]
  |                  |                               |
  |  [Developer Edits / Responds via UI]             |
  |                  |                               |
  |                  |   3. replyComment (Answer)    |
  |                  | ----------------------------> | [Thread Updated]
  |                  |                               |
  |  [Fix Verified]  |   4. resolveComment (Closed)  |
  |                  | ----------------------------> | [Folded / Resolved]
  +------------------+                               +---------------------+
```

---

## VS Code Command API

The following commands are registered in VS Code and can be executed via `vscode.commands.executeCommand(commandName, ...args)`:

### 1. Retrieve Comments (`omnicomment.agent.getComments`)

Fetches all comments or a filtered subset from the active editor or a specified document URI.

#### Arguments
```typescript
interface GetCommentsArgs {
  /** Optional document URI string (e.g. "file:///path/to/doc.md") or vscode.Uri. Defaults to active editor. */
  uri?: string | vscode.Uri;
  /** Whether to include resolved threads. Defaults to true. */
  includeResolved?: boolean;
}
```

#### Returns
`Promise<Comment[]>`

```typescript
const comments = await vscode.commands.executeCommand('omnicomment.agent.getComments', {
  includeResolved: false // Retrieve only unresolved/active comments
});
```

---

### 2. Post a Comment (`omnicomment.agent.postComment`)

Attaches a new inline comment thread to target anchor text within a document.

#### Arguments
```typescript
interface PostCommentArgs {
  /** Optional document URI. Defaults to active editor. */
  uri?: string | vscode.Uri;
  /** Exact or normalized text in the document where the comment should attach. */
  anchorText: string;
  /** Comment content (supports Markdown). */
  content: string;
  /** Author display name (e.g., "ReviewerAgent", "SecurityAuditBot"). */
  author?: string;
}
```

#### Returns
`Promise<Comment | null>` (returns the newly created comment object with its generated UUID).

```typescript
const newComment = await vscode.commands.executeCommand('omnicomment.agent.postComment', {
  anchorText: 'const apiKey = process.env.API_KEY;',
  content: '⚠️ **Security Notice**: Ensure API keys are validated against empty strings.',
  author: 'SecurityAuditAgent'
});

console.log('Created comment ID:', newComment.id);
```

---

### 3. Reply to a Thread (`omnicomment.agent.replyComment`)

Appends a new reply to an existing comment thread.

#### Arguments
```typescript
interface ReplyCommentArgs {
  /** Optional document URI. Defaults to active editor. */
  uri?: string | vscode.Uri;
  /** UUID of the parent comment thread. */
  commentId: string;
  /** Reply content (supports Markdown). */
  content: string;
  /** Author display name. */
  author?: string;
}
```

#### Returns
`Promise<Reply | null>`

```typescript
const reply = await vscode.commands.executeCommand('omnicomment.agent.replyComment', {
  commentId: '5c903516-cf11-444e-9581-567a37228917',
  content: 'I verified the updated check in commit 7a8b9c. Looking good!',
  author: 'SecurityAuditAgent'
});
```

---

### 4. Resolve or Reopen a Thread (`omnicomment.agent.resolveComment`)

Changes the resolution state of a comment thread.

#### Arguments
```typescript
interface ResolveCommentArgs {
  /** Optional document URI. Defaults to active editor. */
  uri?: string | vscode.Uri;
  /** UUID of the target comment thread. */
  commentId: string;
  /**
   * Target status:
   * - `true`: Mark thread as resolved.
   * - `false`: Reopen thread.
   * - `undefined`: Toggle current resolution status.
   */
  resolved?: boolean;
}
```

#### Returns
`Promise<Comment | null>` (the updated comment with `resolved` set).

```typescript
const resolvedComment = await vscode.commands.executeCommand('omnicomment.agent.resolveComment', {
  commentId: '5c903516-cf11-444e-9581-567a37228917',
  resolved: true
});
```

---

### 5. Delete a Comment (`omnicomment.agent.deleteComment`)

Permanently deletes a comment thread and its replies.

#### Arguments
```typescript
interface DeleteCommentArgs {
  /** Optional document URI. Defaults to active editor. */
  uri?: string | vscode.Uri;
  /** UUID of the comment thread to delete. */
  commentId: string;
}
```

#### Returns
`Promise<{ success: boolean }>`

```typescript
const result = await vscode.commands.executeCommand('omnicomment.agent.deleteComment', {
  commentId: '5c903516-cf11-444e-9581-567a37228917'
});
```

---

## Model Context Protocol (MCP) Toolset

For AI agents running via MCP (Claude Desktop, Cursor, Gemini CLI, Jetski), OmniComment exposes the following tool declarations:

```json
{
  "tools": [
    {
      "name": "omnicomment_get_comments",
      "description": "Retrieve inline comments and discussion threads from a document.",
      "parameters": {
        "type": "object",
        "properties": {
          "uri": { "type": "string", "description": "Absolute file path or file URI" },
          "includeResolved": { "type": "boolean", "default": true }
        }
      }
    },
    {
      "name": "omnicomment_post_comment",
      "description": "Post an inline comment anchored to specific text in a document.",
      "parameters": {
        "type": "object",
        "properties": {
          "uri": { "type": "string", "description": "Target file path or URI" },
          "anchorText": { "type": "string", "description": "Snippet of text to anchor to" },
          "content": { "type": "string", "description": "Comment markdown content" },
          "author": { "type": "string", "description": "Agent name" }
        },
        "required": ["anchorText", "content"]
      }
    },
    {
      "name": "omnicomment_reply_comment",
      "description": "Reply to an existing comment thread.",
      "parameters": {
        "type": "object",
        "properties": {
          "uri": { "type": "string" },
          "commentId": { "type": "string", "description": "Parent comment UUID" },
          "content": { "type": "string" },
          "author": { "type": "string" }
        },
        "required": ["commentId", "content"]
      }
    },
    {
      "name": "omnicomment_resolve_comment",
      "description": "Resolve or reopen an inline comment thread.",
      "parameters": {
        "type": "object",
        "properties": {
          "uri": { "type": "string" },
          "commentId": { "type": "string" },
          "resolved": { "type": "boolean" }
        },
        "required": ["commentId"]
      }
    }
  ]
}
```

---

## Prompt Context Injection (`exportContextForLLM`)

When preparing context for an LLM prompt, the `exportContextForLLM()` helper converts the active comments into a compact, model-friendly representation:

```typescript
function exportContextForLLM(comments: Comment[]): string {
  return comments
    .map(c => {
      const status = c.resolved ? '[RESOLVED]' : '[OPEN]';
      const replies = (c.replies || [])
        .map(r => `    - Reply by @${r.author}: "${r.content}"`)
        .join('\n');
      return [
        `### Comment [ID: ${c.id}] ${status}`,
        `Anchored to: "${c.anchor.text}" (lines ${c.anchor.startLine + 1}-${c.anchor.endLine + 1})`,
        `Author: @${c.author}`,
        `Message: "${c.content}"`,
        replies ? `Replies:\n${replies}` : null
      ].filter(Boolean).join('\n');
    })
    .join('\n\n---\n\n');
}
```

#### Output Sample
```markdown
### Comment [ID: 5c903516-cf11-444e-9581-567a37228917] [OPEN]
Anchored to: "function parseCommentsFromSource(src: string)" (lines 146-146)
Author: @CodeReviewer
Message: "Can we support both omnicomment and legacy markers here?"
Replies:
    - Reply by @OmniAgent: "Updated in latest commit with dual-block detection."
```

---

## End-to-End Code Examples

### TypeScript Example

```typescript
import * as vscode from 'vscode';

export async function runAgentCodeReview(documentUri: vscode.Uri) {
  // 1. Fetch current document text
  const doc = await vscode.workspace.openTextDocument(documentUri);
  const text = doc.getText();

  // 2. Fetch existing unresolved comments
  const existingComments: any[] = await vscode.commands.executeCommand(
    'omnicomment.agent.getComments',
    { uri: documentUri, includeResolved: false }
  );

  // 3. Inspect text for potential improvements
  if (text.includes('TODO: implement caching')) {
    const alreadyCommented = existingComments.some(c =>
      c.anchor.text.includes('TODO: implement caching')
    );

    if (!alreadyCommented) {
      await vscode.commands.executeCommand('omnicomment.agent.postComment', {
        uri: documentUri,
        anchorText: 'TODO: implement caching',
        content: 'Consider using an LRU cache or Redis if this endpoint receives high throughput.',
        author: 'PerformanceReviewAgent'
      });
    }
  }
}
```

### Python MCP Agent Example

```python
import json
import urllib.request

def review_markdown_document(mcp_client, file_path: str):
    # 1. Fetch comments via MCP
    result = mcp_client.call_tool("omnicomment_get_comments", {
        "uri": file_path,
        "includeResolved": False
    })
    comments = json.loads(result["content"])

    # 2. Process developer questions
    for thread in comments:
        if "how should I fix this?" in thread["content"].lower():
            mcp_client.call_tool("omnicomment_reply_comment", {
                "uri": file_path,
                "commentId": thread["id"],
                "content": "You can replace the legacy loop with `items.findLast(...)`.",
                "author": "AIAssistant"
            })
```
