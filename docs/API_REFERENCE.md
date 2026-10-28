# OmniComment API Reference

This document provides the authoritative API specification for **OmniComment**, covering data structures, VS Code commands, core TypeScript modules, web components, and CLI utilities.

---

## Table of Contents

1. [Core Data Types & Interfaces](#1-core-data-types--interfaces)
2. [VS Code Command Reference](#2-vs-code-command-reference)
3. [AI Agent API Specification](#3-ai-agent-api-specification)
4. [AnchorEngine API](#4-anchorengine-api)
5. [Storage Adapter API](#5-storage-adapter-api)
6. [Web Component API (`<omni-comment>`)](#6-web-component-api-omni-comment)
7. [Configuration Presets API](#7-configuration-presets-api)
8. [TUI Renderer API](#8-tui-renderer-api)

---

## 1. Core Data Types & Interfaces

All data models are defined in [`src/core/types.ts`](file:///usr/local/google/home/phui/src/tools/editor/Markco/src/core/types.ts).

### `CommentAnchor`
Defines the anchored text and its line/character coordinates within the document.

```typescript
export interface CommentAnchor {
  text: string;         // The exact anchored snippet of text
  startLine: number;    // 0-indexed starting line
  startChar: number;    // 0-indexed starting character on startLine
  endLine: number;      // 0-indexed ending line
  endChar: number;      // 0-indexed ending character on endLine
}
```

### `Reply`
A threaded response attached to a root comment.

```typescript
export interface Reply {
  id: string;               // Unique UUID v4 string
  content: string;          // Markdown text of the reply
  author: string;           // Username or agent identifier
  createdAt: string;        // ISO 8601 timestamp (e.g. 2026-10-28T14:00:00.000Z)
  thumbsUp?: string[];      // Array of usernames who reacted with thumbs up
}
```

### `Comment`
A root comment thread anchored to a specific document range.

```typescript
export interface Comment {
  id: string;               // Unique UUID v4 string
  anchor: CommentAnchor;    // Anchoring coordinate information
  content: string;          // Main comment text
  author: string;           // Username or agent identifier
  createdAt: string;        // ISO 8601 timestamp
  updatedAt?: string;       // ISO 8601 timestamp of last edit/reaction
  resolved?: boolean;       // True if thread is marked resolved
  orphaned?: boolean;       // True if anchor text was deleted from document
  replies?: Reply[];        // Array of threaded replies
  thumbsUp?: string[];      // Array of usernames who reacted with thumbs up
}
```

### `OmniCommentData`
The top-level JSON structure stored inside Markdown comment blocks (`<!-- omnicomment ... -->`):

```typescript
export interface OmniCommentData {
  version: number;          // Schema version (currently 2)
  comments: Comment[];      // Array of active and resolved comments
}
```

---

## 2. VS Code Command Reference

All commands are contributed under the `omnicomment.*` namespace with backward-compatible aliases for `markco.*`, `OmniComment.*`, and `OminiComment.*`.

| Command ID | Title | Description | Arguments |
| :--- | :--- | :--- | :--- |
| `omnicomment.addComment` | Add Comment | Adds a comment at current cursor or selection | None (reads active editor) |
| `omnicomment.deleteComment` | Delete Comment | Deletes comment by ID | `(commentId: string)` |
| `omnicomment.editComment` | Edit Comment | Prompts to update comment body | `(commentId: string)` |
| `omnicomment.toggleSidebar` | Toggle Sidebar | Toggles comments sidebar panel | None |
| `omnicomment.navigateToComment` | Navigate to Comment | Focuses and scrolls to comment anchor | `(commentId: string)` |
| `omnicomment.editorCommentAction` | In-Editor Comment Action | Dispatches actions from custom webviews | `(payload: EditorActionPayload)` |
| `omnicomment.inlineReplyComment` | Respond | Appends reply to comment thread | `(reply: vscode.CommentReply)` |
| `omnicomment.inlineToggleResolve` | Resolve / Reopen | Toggles resolved state on thread | `(thread: vscode.CommentThread)` |
| `omnicomment.inlineDeleteThread` | Delete Comment Thread | Deletes entire thread | `(thread: vscode.CommentThread)` |
| `omnicomment.inlineDeleteCommentItem` | Delete Comment Item | Deletes single comment or reply item | `(item: OmniCommentInlineItem)` |
| `omnicomment.toggleCollapseAllComments` | Collapse / Expand All | Toggles height collapse for all cards | None |
| `omnicomment.applyPreset` | Apply Preset Configuration... | Selects and activates a preset | `(presetName?: string)` |

---

## 3. AI Agent API Specification

The programmatic Agent APIs allow autonomous AI agents, LLM tool-calling loops, and automation scripts to interact with OmniComment headless or inside VS Code.

### `omnicomment.agent.getComments`
Fetches comment threads for a document.

**Parameters:**
```typescript
interface GetCommentsParams {
  uri?: string | vscode.Uri;    // Target document URI (default: active editor)
  includeResolved?: boolean;    // Include resolved threads (default: true)
}
```
**Returns:** `Promise<Comment[]>`

---

### `omnicomment.agent.postComment`
Anchors a new comment thread to a specific text phrase in the document.

**Parameters:**
```typescript
interface PostCommentParams {
  uri?: string | vscode.Uri;    // Target document URI
  anchorText: string;           // Exact or fuzzy target phrase in document
  content: string;              // Comment content (supports Markdown)
  author?: string;              // Author tag (e.g. "DocAuditAgent [AI]")
}
```
**Returns:** `Promise<Comment | null>` (returns created comment, or `null` if target text cannot be found).

---

### `omnicomment.agent.replyComment`
Adds a response to an existing comment thread.

**Parameters:**
```typescript
interface ReplyCommentParams {
  uri?: string | vscode.Uri;    // Target document URI
  commentId: string;            // ID of parent comment thread
  content: string;              // Reply message
  author?: string;              // Author tag
}
```
**Returns:** `Promise<Reply | null>`

---

### `omnicomment.agent.resolveComment`
Marks a comment thread as resolved or reopens it.

**Parameters:**
```typescript
interface ResolveCommentParams {
  uri?: string | vscode.Uri;    // Target document URI
  commentId: string;            // ID of comment to update
  resolved?: boolean;           // Explicit boolean state (default: true)
}
```
**Returns:** `Promise<Comment | null>`

---

### `omnicomment.agent.deleteComment`
Deletes a comment thread from the document.

**Parameters:**
```typescript
interface DeleteCommentParams {
  uri?: string | vscode.Uri;    // Target document URI
  commentId: string;            // ID of comment to delete
}
```
**Returns:** `Promise<{ success: boolean }>`

---

## 4. AnchorEngine API

Defined in [`src/core/AnchorEngine.ts`](file:///usr/local/google/home/phui/src/tools/editor/Markco/src/core/AnchorEngine.ts).

The `AnchorEngine` implements a 3-tier matching pipeline for mapping arbitrary text queries to 0-indexed character offsets and line/character coordinates:

```typescript
export class AnchorEngine {
  /**
   * Locates anchor text within document text using a 3-tier matching pipeline:
   * Tier 1: Exact substring match.
   * Tier 2: Normalized markdown match (stripping markdown bold/italic/del markers).
   * Tier 3: Zero-width space & whitespace collapse match.
   */
  static locateAnchor(
    documentText: string,
    queryAnchorText: string,
    options?: AnchorOptions
  ): AnchorMatchResult | null;

  /**
   * Computes line and character positions from character offset.
   */
  static offsetToPosition(text: string, offset: number): { line: number; character: number };

  /**
   * Computes character offset from line and character position.
   */
  static positionToOffset(text: string, line: number, character: number): number;
}
```

---

## 5. Storage Adapter API

Defined in [`src/storage/MarkdownStorageAdapter.ts`](file:///usr/local/google/home/phui/src/tools/editor/Markco/src/storage/MarkdownStorageAdapter.ts).

```typescript
export interface IStorageAdapter {
  parse(rawText: string): Comment[];
  serialize(documentText: string, comments: Comment[]): string;
  hasComments(rawText: string): boolean;
}

export class MarkdownStorageAdapter implements IStorageAdapter {
  constructor(options?: StorageAdapterOptions);

  parse(rawText: string): Comment[];
  serialize(documentText: string, comments: Comment[]): string;
  hasComments(rawText: string): boolean;
  extractCommentBlockRange(rawText: string): { start: number; end: number } | null;
}
```

---

## 6. Web Component API (`<omni-comment>`)

Defined in [`src/web/OmniCommentElement.ts`](file:///usr/local/google/home/phui/src/tools/editor/Markco/src/web/OmniCommentElement.ts).

### Tag
```html
<omni-comment target="#content" preset="documentation-site"></omni-comment>
```

### HTML Attributes & Properties

| Attribute | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `target` | `string` | `body` | CSS selector for the element whose text can be commented on |
| `preset` | `string` | `default` | Configuration profile (`documentation-site`, `ai-agent-reviewer`, etc.) |
| `storage` | `string` | `local` | Storage mode: `local` (localStorage), `session`, `memory`, or `rest` |
| `author` | `string` | `Anonymous` | Default author name for new comments posted from this surface |
| `readonly` | `boolean` | `false` | When true, comments can only be viewed, not added or edited |

### Custom Events Dispatched

| Event Name | `event.detail` | Description |
| :--- | :--- | :--- |
| `omni-comment:created` | `{ comment: Comment }` | Fired when a new comment thread is posted |
| `omni-comment:replied` | `{ commentId: string, reply: Reply }` | Fired when a reply is added |
| `omni-comment:resolved` | `{ commentId: string, resolved: boolean }` | Fired when a comment is resolved or reopened |
| `omni-comment:deleted` | `{ commentId: string }` | Fired when a comment thread is deleted |

### CSS Custom Variables
Customizable styling tokens via CSS:

```css
omni-comment {
  --omni-primary: #38BDF8;           /* Accent highlight and submit button color */
  --omni-card-bg: #131B2E;           /* Comment card background surface */
  --omni-border: rgba(255,255,255,0.15); /* Card border stroke */
  --omni-text: #F8FAFC;              /* Comment text color */
  --omni-highlight: rgba(56,189,248,0.25); /* Text highlight background */
}
```

---

## 7. Configuration Presets API

Defined in [`src/core/Presets.ts`](file:///usr/local/google/home/phui/src/tools/editor/Markco/src/core/Presets.ts).

```typescript
export type PresetName =
  | 'default'
  | 'documentation-site'
  | 'git-file-review'
  | 'browser-annotator'
  | 'team-collaboration'
  | 'ai-agent-reviewer';

export interface PresetConfig {
  name: PresetName;
  displayName: string;
  description: string;
  uiDensity: 'compact' | 'comfortable' | 'minimal';
  storageMode: 'in-file' | 'localStorage' | 'rest-api' | 'cloud-sync';
  highlightColor: string;
  highlightBorderColor: string;
  features: {
    threading: boolean;
    reactions: boolean;
    resolution: boolean;
    fuzzyReanchor: boolean;
    authorAvatars: boolean;
    agentBadges?: boolean;
    diffLineAnchoring?: boolean;
  };
}

export function getPresetConfig(name: string): PresetConfig;
export function getAllPresets(): PresetConfig[];
```

---

## 8. TUI Renderer API

Defined in [`src/cli/tuiRenderer.ts`](file:///usr/local/google/home/phui/src/tools/editor/Markco/src/cli/tuiRenderer.ts).

```typescript
export interface TuiRenderOptions {
  useColor?: boolean;        // Whether to emit ANSI color escape sequences (default: true)
  unresolvedOnly?: boolean;  // Filter out resolved comments (default: false)
  maxWidth?: number;         // Maximum box width in characters (default: 72)
}

export function renderTuiComments(
  comments: Comment[],
  options?: TuiRenderOptions
): string;

export function renderTuiCard(
  comment: Comment,
  options?: TuiRenderOptions
): string;
```
