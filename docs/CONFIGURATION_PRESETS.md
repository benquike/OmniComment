# OmniComment Configuration & Presets

OmniComment is engineered to work out of the box with zero initial configuration, while providing full control over **UI styling**, **storage backends**, and **workflow behavior** through intuitive presets.

---

## Table of Contents

1. [Preset Profiles](#1-preset-profiles)
2. [Applying Presets](#2-applying-presets)
   - [In VS Code](#in-vs-code)
   - [In Web Plugin / HTML](#in-web-plugin--html)
   - [Programmatically (TypeScript / JS)](#programmatically)
3. [UI Styling & Design Tokens](#3-ui-styling--design-tokens)
   - [CSS Custom Properties (Tokens)](#css-custom-properties)
   - [Custom Themes (Light & Dark)](#custom-themes)
   - [Collapsed Box Zero-DOM Behavior](#collapsed-box-zero-dom-behavior)
4. [Storage Adapter Options](#4-storage-adapter-options)
   - [Markdown In-File Storage](#markdown-in-file-storage)
   - [Local / IndexedDB Storage](#local--indexeddb-storage)
   - [Chrome Storage Sync](#chrome-storage-sync)
   - [REST API Backend Storage](#rest-api-backend-storage)

---

## 1. Preset Profiles

OmniComment provides 5 purpose-built presets tailoring UI density, storage, and workflow:

| Preset Name | Best For | Storage Adapter | UI Density | Key Behavior |
| :--- | :--- | :--- | :--- | :--- |
| `default` | Standard editing | In-File Markdown | Balanced | Clean inline cards, collapsible threads, sidebar navigation |
| `documentation-site` | Public docs, blogs | Browser Local / REST | Compact | Minimalist floating bubble, lightweight chips, reading-focused |
| `git-file-review` | Code reviews | In-File Markdown / Git | Dense | Line-level anchoring, side-by-side diff focus, strict diff tracking |
| `browser-annotator` | Chrome extension | Chrome Sync / Local | Floating | High-contrast highlights, floating thread overlay, badge count |
| `team-collaboration` | Team projects | In-File / Cloud REST | Full | Avatars, reaction counters, threaded replies, resolve workflows |
| `ai-agent-reviewer` | AI agent workflows | In-File / Headless | Structured | Agent badges, automated check hooks, structured JSON output |

---

## 2. Applying Presets

### In VS Code

#### Method 1: Command Palette
1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Type `OmniComment: Apply Preset Configuration...` (`omnicomment.applyPreset`).
3. Choose your desired preset from the quick pick menu.

#### Method 2: `settings.json`
Add the `omnicomment.preset` property to your VS Code settings:

```json
{
  "omnicomment.preset": "ai-agent-reviewer",
  "omnicomment.highlightColor": "rgba(59, 130, 246, 0.25)",
  "omnicomment.highlightBorderColor": "rgba(59, 130, 246, 0.8)"
}
```

---

### In Web Plugin / HTML

Set the `preset` attribute on the custom element:

```html
<omni-comment preset="documentation-site" target="#content"></omni-comment>
```

Or pass it in the initialization function:

```javascript
import { initOmniComment } from '@omnicomment/web-plugin';

initOmniComment({
  target: '#article',
  preset: 'documentation-site',
  storage: 'local'
});
```

---

### Programmatically

```typescript
import { OmniCommentPresets, applyPreset } from '@omnicomment/core';

// Apply the git-file-review preset to the active instance
applyPreset('git-file-review');
```

---

## 3. UI Styling & Design Tokens

### CSS Custom Properties

OmniComment UI components are styled using standard CSS variables, making re-theming straightforward:

```css
:root {
  /* Brand & Accent Colors */
  --omni-primary: #3b82f6;
  --omni-primary-hover: #2563eb;
  --omni-danger: #ef4444;
  --omni-success: #10b981;

  /* Text Highlight Colors */
  --omni-highlight-bg: rgba(255, 212, 0, 0.3);
  --omni-highlight-border: rgba(255, 212, 0, 0.8);
  --omni-highlight-focused-bg: rgba(255, 170, 0, 0.45);

  /* Thread Box Appearance */
  --omni-card-bg: var(--vscode-editor-background, #ffffff);
  --omni-card-border: var(--vscode-widget-border, #e5e7eb);
  --omni-card-radius: 8px;
  --omni-card-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);

  /* Typography */
  --omni-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --omni-font-size-base: 13px;
  --omni-font-size-sm: 11px;
}
```

### Custom Themes

#### Minimalist Theme
```css
.omnicomment-container.theme-minimalist {
  --omni-card-radius: 4px;
  --omni-card-shadow: none;
  --omni-card-border: 1px solid #e0e0e0;
}
```

#### High-Contrast Dark Theme
```css
.omnicomment-container.theme-dark-contrast {
  --omni-highlight-bg: rgba(255, 255, 0, 0.35);
  --omni-highlight-border: #ffff00;
  --omni-card-bg: #1e1e1e;
  --omni-card-border: #444444;
}
```

---

### Collapsed Box Zero-DOM Behavior

When an inlined comment thread is collapsed:
- The comment card DOM is completely omitted from rendering (`return ''`).
- The inline zone height and bottom margin are reset to `0px`.
- Surrounding paragraphs snap together with no visible gap or layout shift.

---

## 4. Storage Adapter Options

OmniComment supports pluggable storage drivers via the `IStorageAdapter` interface:

### Markdown In-File Storage

Comments are stored directly inside the Markdown document in an HTML comment block at the end of the file:

```markdown
<!-- omnicomment
{
  "version": 2,
  "comments": [ ... ]
}
-->
```

**Benefits**:
- Zero external database required.
- Comments are tracked in Git commits and pull requests.
- Comments stay synced across branches and forks.

---

### Local / IndexedDB Storage

For web plugins where modifying source files is not desired, comments can be stored in the browser's `localStorage` or `IndexedDB`:

```javascript
initOmniComment({
  target: '#content',
  storage: 'indexeddb',
  dbName: 'my-site-comments'
});
```

---

### Chrome Storage Sync

For the Chrome Extension, comments can sync across all devices signed into the user's Google Chrome profile:

```typescript
import { ChromeSyncStorageAdapter } from '@omnicomment/storage-chrome';

const storage = new ChromeSyncStorageAdapter();
```

---

### REST API Backend Storage

Connect OmniComment to any HTTP/REST API backend (such as Node.js/Express, Python/FastAPI, or Firebase):

```javascript
initOmniComment({
  target: '#content',
  storage: {
    type: 'rest',
    endpoint: 'https://api.mycompany.com/v1/comments',
    headers: {
      'Authorization': 'Bearer ' + userToken
    }
  }
});
```

The REST adapter communicates using standard HTTP methods:
- `GET /comments?uri={documentUri}` - Fetch comments
- `POST /comments` - Create comment
- `POST /comments/{id}/replies` - Add reply
- `PATCH /comments/{id}` - Update / resolve
- `DELETE /comments/{id}` - Delete comment
