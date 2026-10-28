# OmniComment Universal Integration Guide

This guide covers how to integrate **OmniComment** across three primary environments:
1. [VS Code Editors & Modes](#1-vs-code-integration)
2. [Web Plugin for Any Website / Documentation Site](#2-web-plugin-integration)
3. [Chrome Extension (Manifest V3)](#3-chrome-extension-integration)

---

## 1. VS Code Integration

OmniComment works out of the box with multiple VS Code editor surfaces and modes:

### Supported Editor Modes

| Mode / View | How It Works | Supported Features |
| :--- | :--- | :--- |
| **Standard TextEditor** (`markdown`, `skill`, code) | Uses VS Code TextEditor Decorations and Comments API | Inline chips, collapsed zero-DOM folding, keyboard navigation |
| **Custom WYSIWYG Editors** ("Markdown Editor" / Vditor) | Injected client assets (`media/markdown-editor/`) via auto-sync | In-editor inline thread cards, inline reply boxes, resolved fading |
| **Markdown Preview** | Built-in `markdown-it` plugin | Tooltip badges, highlights, anchor jump |
| **Diff / Review Mode** | Split-screen or unified diff | Line comments on modified chunks |

### Installation in VS Code

1. Package or download the VSIX:
   ```bash
   npx @vscode/vsce package --no-dependencies -o omnicomment.vsix
   code --install-extension omnicomment.vsix
   ```
2. Open any `.md` or `.skill` file.
3. Select any text (or place your cursor on a word) and press:
   - **macOS**: `Cmd + Shift + M`
   - **Linux / Windows**: `Ctrl + Shift + M`

### Enabling for Other Languages (e.g., Python, TypeScript, YAML)

To enable OmniComment highlights and comments for file types other than Markdown:
In your VS Code `settings.json`:
```json
{
  "omnicomment.enabledLanguages": [
    "markdown",
    "skill",
    "python",
    "typescript",
    "yaml"
  ]
}
```

---

## 2. Web Plugin Integration

The OmniComment Web Plugin allows you to add collaborative annotations and commenting to **any website** (documentation portals, blogs, static sites) with a single script tag or npm import.

### Option A: Embed via CDN / Web Component (Zero-Build Setup)

Add this snippet before the closing `</body>` tag on your website:

```html
<!-- Load OmniComment Web Component -->
<script type="module" src="https://unpkg.com/@omnicomment/web-plugin/dist/index.js"></script>

<!-- Attach to your main article or documentation container -->
<omni-comment
  preset="documentation-site"
  target="#article-content"
  storage="local"
></omni-comment>
```

#### Attributes:
- `target`: CSS selector of the text container to enable annotations on (e.g., `#content`, `article`, `.markdown-body`).
- `preset`: Built-in preset (`documentation-site`, `team-collaboration`, etc.).
- `storage`: `local` (localStorage), `indexeddb`, or URL to REST backend (`https://api.example.com/comments`).
- `author`: Current logged-in user name (optional, defaults to `"Guest"`).

---

### Option B: Integration into Docusaurus

In your Docusaurus project:

1. Install the plugin:
   ```bash
   npm install --save @omnicomment/web-plugin
   ```

2. Create a theme wrapper or layout component in `src/theme/DocItem/Layout/index.js`:
   ```javascript
   import React, { useEffect } from 'react';
   import Layout from '@theme-original/DocItem/Layout';
   import { initOmniComment } from '@omnicomment/web-plugin';
   import '@omnicomment/web-plugin/dist/omnicomment.css';

   export default function LayoutWrapper(props) {
     useEffect(() => {
       const cleanup = initOmniComment({
         target: '.markdown',
         preset: 'documentation-site',
         storage: 'local'
       });
       return cleanup;
     }, []);

     return <Layout {...props} />;
   }
   ```

---

### Option C: Integration into VitePress

In `.vitepress/theme/index.ts`:

```typescript
import DefaultTheme from 'vitepress/theme';
import { inBrowser } from 'vitepress';
import { initOmniComment } from '@omnicomment/web-plugin';
import '@omnicomment/web-plugin/dist/omnicomment.css';

export default {
  ...DefaultTheme,
  enhanceApp({ router }) {
    if (inBrowser) {
      router.onAfterRouteChanged = () => {
        setTimeout(() => {
          initOmniComment({
            target: '.vp-doc',
            preset: 'documentation-site',
            storage: 'local'
          });
        }, 100);
      };
    }
  }
};
```

---

### Option D: Hugo / Jekyll / Plain Static HTML

Add to your `layouts/_default/single.html` or `_layouts/post.html`:

```html
<link rel="stylesheet" href="https://unpkg.com/@omnicomment/web-plugin/dist/omnicomment.css">
<script type="module">
  import { initOmniComment } from 'https://unpkg.com/@omnicomment/web-plugin/dist/index.js';

  initOmniComment({
    target: 'article.post-content',
    preset: 'documentation-site',
    storage: 'local'
  });
</script>
```

---

## 3. Chrome Extension Integration

OmniComment can be installed as a Manifest V3 browser extension to annotate arbitrary websites (RFCs, API docs, news, GitHub code):

### Architecture Overview

```
+-----------------------------------------------------------+
| Chrome Extension (MV3)                                    |
|                                                           |
|  +-----------------------+     +------------------------+ |
|  | Background Service    | <-> | Chrome Storage Sync    | |
|  | Worker                |     | (Cross-device sync)    | |
|  +-----------------------+     +------------------------+ |
|             ^                                             |
|             | chrome.runtime.sendMessage                  |
|             v                                             |
|  +------------------------------------------------------+ |
|  | Content Script (@omnicomment/browser-extension)      | |
|  |  - W3C TextQuoteSelector Generator                  | |
|  |  - Floating Annotation Chip                          | |
|  |  - Shadow DOM Container (isolated CSS)               | |
|  +------------------------------------------------------+ |
+-----------------------------------------------------------+
```

### Extension Structure

```
browser-extension/
├── manifest.json
├── src/
│   ├── background/
│   │   └── serviceWorker.ts     # Handles storage sync and badge updates
│   ├── content/
│   │   ├── contentScript.ts     # Injects Shadow DOM UI and handles selections
│   │   └── annotator.css        # Scoped styles
│   └── popup/
│       ├── popup.html           # Quick list of comments on the current domain
│       └── popup.ts
```

### Key Manifest Configuration (`manifest.json`)

```json
{
  "manifest_version": 3,
  "name": "OmniComment - Universal Web Annotator",
  "version": "1.0.0",
  "description": "Annotate and discuss any webpage with robust inline threads",
  "permissions": [
    "storage",
    "activeTab"
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": "icons/icon128.png"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/contentScript.js"],
      "css": ["content/annotator.css"]
    }
  ]
}
```

### Shadow DOM Isolation

The browser extension embeds the comment widgets inside a `ShadowRoot` so that host page styles (bootstrap, tailwind, etc.) do not leak into the comment threads:

```typescript
const hostElement = document.createElement('div');
hostElement.id = 'omnicomment-root';
document.body.appendChild(hostElement);

const shadow = hostElement.attachShadow({ mode: 'open' });
const container = document.createElement('div');
container.className = 'omnicomment-container';
shadow.appendChild(container);
```

---

## 4. Terminal User Interface (TUI) Integration

Because the OmniComment core engine (`AnchorEngine`, `MarkdownStorageAdapter`, and `AgentAPI`) is completely decoupled from browser DOM and VS Code APIs, it runs natively in terminal environments, Neovim/Vim, CLI review tools, and TUI frameworks (e.g., Python Textual, Go Bubbletea, Rust Ratatui, Node Ink/Blessed).

### TUI Rendering Model

In terminal environments:
- **Anchors & Highlights**: Displayed using 24-bit TrueColor or 16-color ANSI escape sequences (e.g., `\x1b[43;30m` yellow highlight).
- **Inline Comment Cards**: Rendered with Unicode box-drawing characters (`┌─`, `│`, `└─`, `├─`) directly under the line where the comment was created.
- **Collapsing / Folding**: Collapsed comments consume 0 terminal rows (or a single-line badge `💬 [1]`), snapping following code rows up immediately.

```
12 │ function calculateTax(income: number): number {
13 │   return income * 0.20;
   │     ┌─ 💬 OPEN  @CodeReviewer (2026-10-28)────────────────────┐
   │     │  Consider checking for negative income values.          │
   │     ├─ Replies (1) ───────────────────────────────────────────┤
   │     │  @Developer: Added validation guard clause in commit 4b2 │
   │     └─────────────────────────────────────────────────────────┘
14 │ }
```

### CLI Terminal View Example

You can render any commented document directly to terminal stdout:

```typescript
import * as fs from 'fs';
import { renderMarkdownWithTuiComments } from '@omnicomment/core/cli/tuiRenderer';

const content = fs.readFileSync('spec/OmniComment.md', 'utf-8');
const terminalOutput = renderMarkdownWithTuiComments(content, {
  useColor: true,
  showResolved: false // Only show unresolved threads
});

console.log(terminalOutput);
```

### Neovim Lua Integration (via Extmarks & Virtual Lines)

In Neovim, comments are projected as non-destructive virtual lines (`virt_lines`) that don't alter the buffer:

```lua
-- omnicomment.lua
local M = {}
local ns_id = vim.api.nvim_create_namespace("omnicomment")

function M.render_comments(comments)
  vim.api.nvim_buf_clear_namespace(0, ns_id, 0, -1)
  for _, c in ipairs(comments) do
    if not c.resolved then
      -- Highlight anchor range
      vim.api.nvim_buf_add_highlight(0, ns_id, "Visual", c.anchor.startLine, c.anchor.startChar, c.anchor.endChar)
      
      -- Render inline comment box using virt_lines
      local virt_lines = {
        { { "    ┌─ 💬 " .. c.author .. ": " .. c.content, "Comment" } },
        { { "    └────────────────────────────────────────", "Comment" } }
      }
      vim.api.nvim_buf_set_extmark(0, ns_id, c.anchor.endLine, 0, {
        virt_lines = virt_lines,
        virt_lines_above = false
      })
    end
  end
end

return M
```

